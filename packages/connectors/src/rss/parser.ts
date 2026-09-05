import { stripHtml, ValidationError } from '@trendhunter/shared';

/**
 * A small, deliberately hostile-input-tolerant XML reader for feeds.
 *
 * A general XML parser is the wrong tool here and adding one as a dependency
 * would be worse: feeds are fetched from URLs an operator can point anywhere,
 * so the parser is an attack surface. This one is written to the shape feeds
 * actually take, and every dimension a hostile document could grow along is
 * bounded — document length, nesting depth, node count, attribute count and the
 * length of a single text run.
 *
 * Deliberate non-goals: no DTD processing, no entity declarations, no external
 * references. `<!DOCTYPE …>` is skipped wholesale, which makes the classic
 * entity-expansion attacks structurally impossible rather than merely bounded.
 */

export interface XmlNode {
  /** Local name, lower-cased. `content:encoded` parses to `encoded`. */
  readonly name: string;
  /** Namespace prefix, lower-cased; empty when the element is unprefixed. */
  readonly prefix: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  /** Text and CDATA directly inside this element, entities already decoded. */
  readonly text: string;
}

export interface XmlLimits {
  readonly maxLength: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTextLength: number;
  readonly maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxLength: 4_000_000,
  maxDepth: 24,
  maxNodes: 30_000,
  maxTextLength: 500_000,
  maxAttributes: 40,
};

interface MutableNode {
  name: string;
  prefix: string;
  attributes: Record<string, string>;
  children: MutableNode[];
  text: string;
}

/**
 * Parses a document into a tree.
 *
 * Structural sloppiness is tolerated the way a browser tolerates it — unclosed
 * elements are closed at the end of the document, a stray closing tag that
 * matches nothing on the stack is ignored — because real feeds are frequently
 * malformed and refusing them would lose real content. Exceeding a *bound*, by
 * contrast, is always fatal: that is the difference between a sloppy feed and a
 * hostile one.
 */
export function parseXml(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlNode {
  if (source.length > limits.maxLength) {
    throw new ValidationError(
      `The feed document is larger than the ${String(limits.maxLength)} character limit.`,
    );
  }

  const document: MutableNode = {
    name: '#document',
    prefix: '',
    attributes: {},
    children: [],
    text: '',
  };
  const stack: MutableNode[] = [document];
  let nodeCount = 0;
  let index = 0;

  const current = (): MutableNode => stack[stack.length - 1] ?? document;

  const appendText = (value: string, decode: boolean): void => {
    if (value === '') return;
    const node = current();
    const addition = decode ? decodeEntities(value) : value;
    if (node.text.length + addition.length > limits.maxTextLength) {
      throw new ValidationError('A feed element exceeded the permitted text length.');
    }
    node.text += addition;
  };

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) {
      appendText(source.slice(index), true);
      break;
    }
    if (open > index) appendText(source.slice(index, open), true);

    if (source.startsWith('<!--', open)) {
      index = skipPast(source, '-->', open + 4);
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      // CDATA is literal by definition: entities inside it are not references.
      appendText(end === -1 ? source.slice(open + 9) : source.slice(open + 9, end), false);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      index = skipPast(source, '?>', open + 2);
      continue;
    }
    if (source.startsWith('<!', open)) {
      index = skipDeclaration(source, open);
      continue;
    }

    const close = findTagEnd(source, open + 1);
    if (close === -1) {
      // A truncated final tag: whatever follows cannot be trusted, so stop.
      break;
    }

    const body = source.slice(open + 1, close);
    index = close + 1;

    if (body.startsWith('/')) {
      closeElement(stack, splitName(body.slice(1).trim()).name);
      continue;
    }

    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameEnd = findNameEnd(inner);
    const { name, prefix } = splitName(inner.slice(0, nameEnd));
    if (name === '') continue;

    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      throw new ValidationError('The feed document contains too many elements.');
    }
    if (stack.length > limits.maxDepth) {
      throw new ValidationError('The feed document is nested too deeply.');
    }

    const element: MutableNode = {
      name,
      prefix,
      attributes: parseAttributes(inner.slice(nameEnd), limits.maxAttributes),
      children: [],
      text: '',
    };
    current().children.push(element);
    if (!selfClosing) stack.push(element);
  }

  const root = document.children[0];
  if (!root) throw new ValidationError('The document contains no XML elements.');
  return document;
}

/**
 * Pops the stack back to the matching open element.
 *
 * Popping to the *match* rather than popping once repairs the common feed bug
 * where an inner element was never closed; popping once would silently reparent
 * every later sibling.
 */
function closeElement(stack: MutableNode[], name: string): void {
  for (let depth = stack.length - 1; depth > 0; depth -= 1) {
    if (stack[depth]?.name === name) {
      stack.length = depth;
      return;
    }
  }
}

/** Finds the `>` that ends a tag, ignoring any inside a quoted attribute value. */
function findTagEnd(source: string, from: number): number {
  let quote = '';
  for (let i = from; i < source.length; i += 1) {
    const character = source[i];
    if (character === undefined) break;
    if (quote !== '') {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return i;
  }
  return -1;
}

function findNameEnd(body: string): number {
  const match = /[\s/]/.exec(body);
  return match?.index ?? body.length;
}

function splitName(raw: string): { name: string; prefix: string } {
  const lowered = raw.trim().toLowerCase();
  const colon = lowered.indexOf(':');
  if (colon === -1) return { name: lowered, prefix: '' };
  return { name: lowered.slice(colon + 1), prefix: lowered.slice(0, colon) };
}

const ATTRIBUTE_PATTERN =
  /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseAttributes(body: string, maxAttributes: number): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (body.trim() === '') return attributes;

  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = ATTRIBUTE_PATTERN.exec(body)) !== null) {
    if (match[0] === '') {
      ATTRIBUTE_PATTERN.lastIndex += 1;
      continue;
    }
    count += 1;
    if (count > maxAttributes) break;
    const key = splitName(match[1] ?? '').name;
    if (key === '') continue;
    attributes[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * Skips a `<!…>` declaration, including a DOCTYPE with an internal subset.
 *
 * Nothing inside is interpreted; the subset is only tracked so that a `>` in an
 * entity declaration cannot be mistaken for the end of the declaration.
 */
function skipDeclaration(source: string, start: number): number {
  let depth = 0;
  for (let i = start + 2; i < source.length; i += 1) {
    const character = source[i];
    if (character === '[') depth += 1;
    else if (character === ']') depth = Math.max(0, depth - 1);
    else if (character === '>' && depth === 0) return i + 1;
  }
  return source.length;
}

function skipPast(source: string, terminator: string, from: number): number {
  const end = source.indexOf(terminator, from);
  return end === -1 ? source.length : end + terminator.length;
}

/**
 * Decodes the five predefined XML entities and numeric character references.
 *
 * Named HTML entities are deliberately left alone: feed bodies pass through
 * `stripHtml` afterwards, which decodes the wider set, and decoding them twice
 * here would turn a literal `&amp;lt;` into a tag.
 */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return decodeNumeric(entity) ?? match;
    }
  });
}

function decodeNumeric(entity: string): string | null {
  const isHex = entity.startsWith('#x') || entity.startsWith('#X');
  const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return null;
  // Surrogate halves are not characters and would produce lone surrogates.
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;
  return String.fromCodePoint(codePoint);
}

/** Direct children with the given local name, ignoring namespace prefix. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function childNamed(node: XmlNode, ...names: readonly string[]): XmlNode | undefined {
  for (const name of names) {
    const found = node.children.find((child) => child.name === name);
    if (found) return found;
  }
  return undefined;
}

/** Text of an element and everything under it, which is what feed bodies need. */
export function deepText(node: XmlNode): string {
  let text = node.text;
  for (const child of node.children) text += ` ${deepText(child)}`;
  return text;
}

export function textOf(node: XmlNode | undefined): string {
  return node === undefined ? '' : deepText(node).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Feed extraction
// ---------------------------------------------------------------------------

export interface ParsedFeedItem {
  /** Provider identity: `guid`, Atom `id`, or the link as a last resort. */
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly summary: string;
  readonly content: string;
  readonly author: string | null;
  /** The raw published date string; parsing is normalisation's job. */
  readonly publishedAt: string | null;
  readonly categories: readonly string[];
}

export interface ParsedFeed {
  readonly title: string;
  readonly siteUrl: string;
  readonly items: readonly ParsedFeedItem[];
}

/** Bounds the number of entries taken from one document. */
export const MAX_FEED_ITEMS = 200;

/**
 * Reads RSS 2.0, RDF (RSS 1.0) and Atom out of a document.
 *
 * The three dialects disagree about almost everything except that an entry has
 * a title, a link, a body and a date, so they are reconciled here and every
 * consumer downstream sees one shape.
 */
export function parseFeed(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): ParsedFeed {
  const document = parseXml(source, limits);

  const rss = childNamed(document, 'rss');
  if (rss) {
    const channel = childNamed(rss, 'channel');
    if (!channel) throw new ValidationError('The RSS document has no channel element.');
    return {
      title: textOf(childNamed(channel, 'title')),
      siteUrl: textOf(childNamed(channel, 'link')),
      items: childrenNamed(channel, 'item').slice(0, MAX_FEED_ITEMS).map(readRssItem),
    };
  }

  const atom = childNamed(document, 'feed');
  if (atom) {
    return {
      title: textOf(childNamed(atom, 'title')),
      siteUrl: atomLink(atom),
      items: childrenNamed(atom, 'entry').slice(0, MAX_FEED_ITEMS).map(readAtomEntry),
    };
  }

  // RSS 1.0 keeps items as siblings of the channel rather than inside it.
  const rdf = childNamed(document, 'rdf');
  if (rdf) {
    const channel = childNamed(rdf, 'channel');
    return {
      title: channel ? textOf(childNamed(channel, 'title')) : '',
      siteUrl: channel ? textOf(childNamed(channel, 'link')) : '',
      items: childrenNamed(rdf, 'item').slice(0, MAX_FEED_ITEMS).map(readRssItem),
    };
  }

  throw new ValidationError('The document is not an RSS, RDF or Atom feed.');
}

function readRssItem(item: XmlNode): ParsedFeedItem {
  const link = textOf(childNamed(item, 'link'));
  const guid = textOf(childNamed(item, 'guid'));
  const description = textOf(childNamed(item, 'description'));
  // `content:encoded` carries the full article where the description is a teaser.
  const encoded = textOf(childNamed(item, 'encoded'));

  return {
    id: firstNonEmpty(guid, link, textOf(childNamed(item, 'title'))),
    title: textOf(childNamed(item, 'title')),
    link: firstNonEmpty(link, guid.startsWith('http') ? guid : ''),
    summary: stripHtml(description).replace(/\s+/g, ' ').trim(),
    content: stripHtml(firstNonEmpty(encoded, description)).replace(/\s+/g, ' ').trim(),
    author: emptyToNull(textOf(childNamed(item, 'creator', 'author'))),
    publishedAt: emptyToNull(textOf(childNamed(item, 'pubdate', 'date', 'published'))),
    categories: childrenNamed(item, 'category')
      .map((node) => textOf(node) || (node.attributes.term ?? ''))
      .filter((value) => value !== ''),
  };
}

function readAtomEntry(entry: XmlNode): ParsedFeedItem {
  const link = atomLink(entry);
  const summary = textOf(childNamed(entry, 'summary'));
  const content = textOf(childNamed(entry, 'content'));
  const authorNode = childNamed(entry, 'author');

  return {
    id: firstNonEmpty(textOf(childNamed(entry, 'id')), link),
    title: textOf(childNamed(entry, 'title')),
    link,
    summary: stripHtml(summary).replace(/\s+/g, ' ').trim(),
    content: stripHtml(firstNonEmpty(content, summary)).replace(/\s+/g, ' ').trim(),
    author: emptyToNull(authorNode ? textOf(childNamed(authorNode, 'name')) : ''),
    publishedAt: emptyToNull(textOf(childNamed(entry, 'published', 'updated'))),
    categories: childrenNamed(entry, 'category')
      .map((node) => node.attributes.term ?? textOf(node))
      .filter((value) => value !== ''),
  };
}

/**
 * Resolves an Atom `link`.
 *
 * Atom entries carry several links distinguished by `rel`; the alternate one is
 * the article. `rel="self"` points back at the feed and would make every entry
 * in a feed share a URL, which deduplication would then collapse into one item.
 */
function atomLink(node: XmlNode): string {
  const links = childrenNamed(node, 'link');
  const alternate =
    links.find((link) => link.attributes.rel === 'alternate') ??
    links.find((link) => link.attributes.rel === undefined);
  return alternate?.attributes.href ?? textOf(childNamed(node, 'link'));
}

function firstNonEmpty(...values: readonly string[]): string {
  for (const value of values) {
    if (value.trim() !== '') return value.trim();
  }
  return '';
}

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}
