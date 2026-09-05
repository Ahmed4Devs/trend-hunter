'use client';

import {
  ANALYTICS_RANGES,
  TERMINOLOGY_PREFERENCES,
  THEME_PREFERENCES,
  TRANSLATION_MODES,
  UI_LOCALES,
  type UserSettings,
} from '@trendhunter/types';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Switch,
  toast,
} from '@trendhunter/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { setLocale } from '@/app/actions/locale';
import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * The account's stored preferences.
 *
 * The interface language is stored here *and* written to the locale cookie on
 * save. The cookie is what the server reads to render, so persisting the
 * preference without updating it would leave the reader on the old language
 * until they changed it again from the header — the setting would look broken
 * while being stored correctly.
 */
export function PreferencesForm({ settings }: { readonly settings: UserSettings }) {
  const t = useTranslations('settings.preferences');
  const themes = useTranslations('settings.theme');
  const locales = useTranslations('locale');
  const translations = useTranslations('translations');
  const dashboard = useTranslations('dashboard.range');
  const common = useTranslations('common');
  const router = useRouter();

  const [values, setValues] = useState(settings);
  const [pending, setPending] = useState(false);

  function set<TKey extends keyof UserSettings>(key: TKey, value: UserSettings[TKey]): void {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/settings', {
        method: 'PATCH',
        body: {
          locale: values.locale,
          theme: values.theme,
          translationMode: values.translationMode,
          terminologyPreference: values.terminologyPreference,
          aiClassificationEnabled: values.aiClassificationEnabled,
          emailNotificationsEnabled: values.emailNotificationsEnabled,
          emergingTrendAlerts: values.emergingTrendAlerts,
          arabicOpportunityAlerts: values.arabicOpportunityAlerts,
          defaultAnalyticsRange: values.defaultAnalyticsRange,
        },
      });
      await setLocale(values.locale);
      toast.success(t('saved'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  const toggles = [
    { key: 'aiClassificationEnabled', labelKey: 'aiClassification' },
    { key: 'emailNotificationsEnabled', labelKey: 'emailNotifications' },
    { key: 'emergingTrendAlerts', labelKey: 'emergingAlerts' },
    { key: 'arabicOpportunityAlerts', labelKey: 'arabicAlerts' },
  ] as const;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="settings-locale">{t('locale')}</Label>
          <Select
            value={values.locale}
            onValueChange={(value) => {
              set('locale', value as UserSettings['locale']);
            }}
          >
            <SelectTrigger id="settings-locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UI_LOCALES.map((value) => (
                <SelectItem key={value} value={value}>
                  {locales(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-theme">{t('theme')}</Label>
          <Select
            value={values.theme}
            onValueChange={(value) => {
              set('theme', value as UserSettings['theme']);
            }}
          >
            <SelectTrigger id="settings-theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_PREFERENCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {themes(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-mode">{t('translationMode')}</Label>
          <Select
            value={values.translationMode}
            onValueChange={(value) => {
              set('translationMode', value as UserSettings['translationMode']);
            }}
          >
            <SelectTrigger id="settings-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSLATION_MODES.map((value) => (
                <SelectItem key={value} value={value}>
                  {translations(`mode.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-terminology">{t('terminology')}</Label>
          <Select
            value={values.terminologyPreference}
            onValueChange={(value) => {
              set('terminologyPreference', value as UserSettings['terminologyPreference']);
            }}
          >
            <SelectTrigger id="settings-terminology">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINOLOGY_PREFERENCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {translations(`terminology.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-range">{t('analyticsRange')}</Label>
          <Select
            value={values.defaultAnalyticsRange}
            onValueChange={(value) => {
              set('defaultAnalyticsRange', value);
            }}
          >
            <SelectTrigger id="settings-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANALYTICS_RANGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {dashboard(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        {toggles.map((toggle) => (
          <Label key={toggle.key} className="flex items-center justify-between gap-4 font-normal">
            <span className="text-sm">{t(toggle.labelKey)}</span>
            <Switch
              checked={values[toggle.key]}
              onCheckedChange={(checked) => {
                set(toggle.key, checked);
              }}
            />
          </Label>
        ))}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Spinner label={common('loading')} /> : null}
        {common('save')}
      </Button>
    </form>
  );
}
