# @void-monorepo/ui

Shared UI component library and design system for Void Cloud applications.

## Exports

- `Header` — app header with logo link, badge, and primary nav.
  Props: `appName`, `badgeText?` (default `'Void Cloud'`), `links?`
  (`{ label, href, active? }[]`), `homeHref?` (default `'/'`),
  `navAriaLabel?` (default `'Primary'`), plus `className` / `style` /
  any other `<header>` attributes (passthrough).
- `Card` — content card with title, description, tag, children, footer.
  Props: `title`, `description?`, `tag?`, `children?`, `footer?`,
  `headingLevel?` (`1–6`, default `3`), plus `className` / `style` /
  any other `<div>` attributes (passthrough).
- `Button` — discriminated union:
  - Button: `<Button variant="primary" onClick={...}>` (renders `<button
    type="button">` by default; all native button props passthrough).
  - Link: `<Button asLink href="/path" target="_blank" rel="...">`
    (renders `<a>`; `target`/`rel`/all native anchor props passthrough).
    A disabled link (`aria-disabled`) renders non-interactive and blocks
    navigation in its click handler.
  - `variant`: `'primary' | 'secondary' | 'outline'` (default `'primary'`).

## Styles

This package ships design tokens + a small reset/utility layer as
`@void-monorepo/ui/styles.css` (source: `src/styles/tokens.css`).
Consumers **must** import it once at the app root:

```ts
import '@void-monorepo/ui/styles.css';
```

Component colors reference these tokens via `var(--void-*)` with built-in
hex fallbacks, so components render sanely even if the stylesheet import
is missing — but the import is the supported contract.

## Example

```tsx
import { Header, Card, Button } from '@void-monorepo/ui';
import '@void-monorepo/ui/styles.css';

export function Page() {
  return (
    <>
      <Header
        appName="Void Web"
        links={[
          { label: 'Home', href: '/', active: true },
          { label: 'Dashboard', href: '/dashboard' },
        ]}
      />
      <Card title="Hello" description="World" headingLevel={2}>
        <Button asLink href="/dashboard" variant="primary">
          Open dashboard
        </Button>
      </Card>
    </>
  );
}
```

## Notes

- `src/styles/tokens.css` intentionally co-locates tokens, reset (`body`,
  `*`), and utilities. Splitting the reset into a separate file was
  considered and deliberately **not** done here to avoid changing the
  `./styles.css` export contract; revisit if consumers need tokens-only.
- No test runner is configured for this package; `pnpm --filter
  @void-monorepo/ui typecheck` is the verification gate.
