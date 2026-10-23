import { Header } from '@void-monorepo/ui';
import { coffeeHeaderStyle } from '@void-monorepo/coffee-theme';

export type AdminSection = 'overview' | 'orders' | 'menu' | 'crons';

const links = [
  { section: 'overview', label: 'Overview', href: '/' },
  { section: 'orders', label: 'Orders', href: '/orders' },
  { section: 'menu', label: 'Menu', href: '/menu' },
  { section: 'crons', label: 'Crons', href: '/crons' },
] as const;

export function AdminHeader({ active, siteUrl }: { active: AdminSection; siteUrl: string }) {
  return (
    <Header
      appName="Crew Coffee"
      badgeText="Back office"
      homeHref="/"
      links={[
        ...links.map((link) => ({
          label: link.label,
          href: link.href,
          active: link.section === active,
        })),
        { label: 'View café ↗', href: siteUrl },
      ]}
      style={coffeeHeaderStyle}
    />
  );
}
