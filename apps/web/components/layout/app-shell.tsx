'use client';

import type { AuthenticatedUser } from '@trendhunter/types';
import { Dialog, DialogContent, DialogTitle } from '@trendhunter/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { Brand } from './brand';
import { SidebarNav } from './sidebar-nav';
import { TopBar } from './top-bar';

export interface AppShellProps {
  readonly user: AuthenticatedUser;
  readonly children: ReactNode;
}

/**
 * The signed-in layout: a fixed sidebar beside a scrolling main column.
 *
 * The sidebar is a permanent rail from `lg` up and a dialog below it, rather
 * than one element that changes position. A single element would have to be
 * both a landmark and a modal, and a drawer that is only visually hidden still
 * takes focus and is still read out by a screen reader on a phone.
 *
 * Sides are logical (`border-e`, not `border-r`), so Arabic moves the whole
 * rail to the right without a second layout.
 *
 * The drawer is closed by the navigation callback rather than by watching the
 * path: the layout is not unmounted by a route change, and closing it from an
 * effect on `pathname` would be a state update in response to a render.
 */
export function AppShell({ user, children }: AppShellProps) {
  const nav = useTranslations('nav');
  const common = useTranslations('common');
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-e border-border bg-sidebar lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          closeLabel={common('close')}
          className="start-0 top-0 h-full max-w-72 translate-x-0 translate-y-0 rounded-none bg-sidebar p-0 rtl:start-auto rtl:end-0"
        >
          <DialogTitle className="sr-only">{nav('openMenu')}</DialogTitle>
          <div className="flex h-full flex-col">
            <Brand />
            <SidebarNav
              onNavigate={() => {
                setDrawerOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          onOpenMenu={() => {
            setDrawerOpen(true);
          }}
        />
        <main className="flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
