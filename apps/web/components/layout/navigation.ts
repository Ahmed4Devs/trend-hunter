import {
  BookmarkIcon,
  FileTextIcon,
  FolderTreeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  type LucideIcon,
  MessagesSquareIcon,
  NewspaperIcon,
  RadioIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react';

/**
 * The navigation tree.
 *
 * Data, not markup, so the sidebar and the mobile drawer render the same list
 * and cannot drift apart. `labelKey` is a message key rather than a label —
 * a literal here would be the one string in the product that never translates.
 */

export interface NavigationItem {
  readonly href: string;
  readonly labelKey: string;
  readonly icon: LucideIcon;
  /** Only shown to administrators. A hint for the UI; the API decides. */
  readonly adminOnly?: boolean;
}

export interface NavigationSection {
  readonly titleKey: string;
  readonly items: readonly NavigationItem[];
}

export const NAVIGATION: readonly NavigationSection[] = [
  {
    titleKey: 'sectionMain',
    items: [{ href: '/', labelKey: 'dashboard', icon: LayoutDashboardIcon }],
  },
  {
    titleKey: 'sectionDiscover',
    items: [
      { href: '/topics', labelKey: 'topics', icon: FolderTreeIcon },
      { href: '/posts', labelKey: 'posts', icon: NewspaperIcon },
      { href: '/sources', labelKey: 'sources', icon: RadioIcon },
      { href: '/saved', labelKey: 'saved', icon: BookmarkIcon },
    ],
  },
  {
    titleKey: 'sectionCreate',
    items: [
      { href: '/content', labelKey: 'contentStudio', icon: SparklesIcon },
      { href: '/threads', labelKey: 'threads', icon: MessagesSquareIcon },
      { href: '/translations', labelKey: 'translations', icon: FileTextIcon },
    ],
  },
  {
    titleKey: 'sectionOperate',
    items: [
      { href: '/reports', labelKey: 'reports', icon: ListChecksIcon },
      { href: '/scans', labelKey: 'scanHistory', icon: HistoryIcon },
      { href: '/settings', labelKey: 'settings', icon: SettingsIcon },
    ],
  },
];

/**
 * Whether a navigation item is the one the current path belongs to.
 *
 * The dashboard is matched exactly; everything else matches its subtree, so
 * a post's detail page still highlights "Posts". Without the prefix check the
 * sidebar would go blank the moment a reader opened a detail page.
 */
export function isActivePath(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
