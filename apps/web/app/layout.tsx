import { DirectionProvider, Toaster, TooltipProvider } from '@trendhunter/ui';
import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { ThemeProvider } from '@/components/providers/theme-provider';
import { directionOf } from '@/lib/locale';
import { resolveLocale } from '@/lib/locale.server';

import './globals.css';

/**
 * Both faces are loaded as variables and composed in the token stylesheet:
 * Latin first, Arabic second. `display: 'swap'` shows the fallback immediately
 * rather than leaving the reader with invisible text while the face downloads —
 * which matters most for Arabic, where the fallback is often the system's only
 * Arabic font anyway.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
    // This is a private dashboard behind a session; there is nothing here that
    // should ever reach an index.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#07111f' },
  ],
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await resolveLocale();
  const direction = directionOf(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={direction}
      className={`${inter.variable} ${notoSansArabic.variable} h-full`}
      // next-themes writes `class` on this element before paint; without this
      // React would report the server's markup as mismatched on every load.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Radix reads direction from context, not from the document. */}
          <DirectionProvider dir={direction}>
            <ThemeProvider>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
              <Toaster dir={direction} position={direction === 'rtl' ? 'top-left' : 'top-right'} />
            </ThemeProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
