# Design System — shadcn/ui + Tailwind CSS

## Overview

The Job Tracker frontend uses **shadcn/ui** components built on Tailwind CSS with HSL-based CSS variables. All styling follows standard Tailwind conventions with shadcn's `bg-card`, `text-foreground`, `text-muted-foreground`, `border` token system.

**Key dependencies:** `clsx`, `tailwind-merge`, `class-variance-authority`

---

## Color Tokens (CSS Variables)

Defined in `globals.css` using HSL values, consumed via `hsl(var(--token))` in Tailwind config.

| Token | Light Mode | Usage |
|-------|-----------|-------|
| `--background` | white | Page background |
| `--foreground` | near-black | Primary text |
| `--card` | white | Card backgrounds |
| `--muted` | light gray | Table headers, inactive surfaces |
| `--muted-foreground` | mid gray | Secondary text, labels, metadata |
| `--primary` | dark | Buttons, links, active states |
| `--primary-foreground` | white | Text on primary bg |
| `--secondary` | light gray | Secondary button bg, keyword badges |
| `--destructive` | red | Delete actions, error states |
| `--border` | light gray | All borders (cards, tables, inputs) |
| `--input` | light gray | Input field borders |
| `--ring` | dark | Focus ring color |

---

## Typography

| Font | Class | Usage |
|------|-------|-------|
| Inter | (default body) | All text, headings, body |
| Space Grotesk | `font-label` | Section labels, column headers, technical labels |

### Conventions
- Section headers: `font-label text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground`
- Metrics/numbers: `font-mono tabular-nums`
- Page headings: `text-xl font-semibold`

---

## Components

### Button (`components/ui/button.tsx`)

| Variant | Usage | Example |
|---------|-------|---------|
| `default` | Primary actions (CTAs, new jobs badge) | `<Button>` |
| `outline` | Secondary actions (Update, pagination) | `<Button variant="outline">` |
| `secondary` | Tertiary actions | `<Button variant="secondary">` |
| `ghost` | Icon buttons (delete) | `<Button variant="ghost" size="icon">` |
| `destructive` | Destructive actions | `<Button variant="destructive">` |

Sizes: `default` (h-10), `sm` (h-9), `xs` (h-7), `lg` (h-11), `icon` (h-10 w-10)

### Table (`components/ui/table.tsx`)

```tsx
<div className="border rounded-lg">
  <Table>
    <TableHeader>
      <TableRow className="bg-muted/50 font-label text-[10px] uppercase tracking-[0.05em]">
        <TableHead>Column</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow className={isRead ? 'bg-muted/30 text-muted-foreground' : ''}>
        <TableCell>Data</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</div>
```

- Wrapper: `border rounded-lg` (shadcn `--border` token)
- Header row: `bg-muted/50` with Space Grotesk labels
- Body rows: auto `border-b` via shadcn TableRow
- Reviewed/read rows: `bg-muted/30 text-muted-foreground` (dimmed)
- Overflow: Table component wraps in `overflow-x-auto` div

### Badge (`components/ui/badge.tsx`)

| Variant | Classes | Usage |
|---------|---------|-------|
| `default` | `bg-primary/10 text-primary` | Default |
| `secondary` | `bg-secondary text-secondary-foreground` | Keywords |
| `success` | `bg-green-500/15 text-green-700` | Applied status |
| `warning` | `bg-amber-400/20 text-amber-700` | Medium score |
| `error` | `bg-red-400/15 text-red-700` | High score |
| `muted` | `bg-muted text-muted-foreground` | Neutral |

### Score Badges (`components/score-badge.tsx`)

Uses shadcn Badge internally. Four specialized components:

- **StatusChip** — new: `bg-blue-500/15`, reviewed: `bg-muted`, applied: `bg-green-500/15`
- **FitBadge** — >= 70%: `text-green-600`, >= 40%: `text-amber-600`, else: `text-muted-foreground`

### Input (`components/ui/input.tsx`)

Standard shadcn input: `border border-input rounded-md` with focus ring.

### Textarea (`components/ui/textarea.tsx`)

Standard shadcn textarea: `border border-input rounded-md` with focus ring.

### Stat Cards (Dashboard)

```
bg-card rounded-lg p-7 border
```

- Metric: `text-2xl font-bold font-mono tabular-nums`
- Label: `font-label text-[10px] text-muted-foreground tracking-[0.05em] uppercase`
- Hover: `hover:shadow-sm`

### Tooltip (Custom)

Fixed-position tooltip that auto-adjusts to viewport:
- Trigger: `w-2.5 h-2.5` "i" circle with `border border-border`
- Popup: `fixed z-[9999] bg-black text-white rounded-md px-2.5 py-2 w-48 shadow-lg`
- Position: calculated from `getBoundingClientRect()`, clamped to viewport edges

---

## Responsive Breakpoints

Table columns hide progressively:

| Breakpoint | Width | Columns visible |
|------------|-------|----------------|
| Default | < 768px | Fit, Job, Status, Actions |
| `md` | 768px+ | + Seen |
| `lg` | 1024px+ | + Location |
| `xl` | 1280px+ | + Salary |

Tier column: removed from tables (visible on job detail page).

---

## Navigation

Sticky glassmorphic nav: `bg-background/80 backdrop-blur-xl border-b`

Links: `text-muted-foreground hover:text-foreground`

---

## Utility Classes

| Class | Source | Usage |
|-------|--------|-------|
| `.tabular-nums` | `globals.css` | Aligned numbers in tables/metrics |
| `cn()` | `lib/utils.ts` | Merge Tailwind classes (clsx + twMerge) |

---

## File Structure

```
apps/web/
├── app/globals.css          # CSS variables (shadcn HSL tokens)
├── tailwind.config.ts       # Tailwind + shadcn color/radius config
├── lib/utils.ts             # cn() helper
├── components/
│   ├── ui/
│   │   ├── button.tsx       # shadcn Button (cva variants)
│   │   ├── badge.tsx        # shadcn Badge (cva variants)
│   │   ├── table.tsx        # shadcn Table components
│   │   ├── input.tsx        # shadcn Input
│   │   └── textarea.tsx     # shadcn Textarea
│   └── score-badge.tsx      # StatusChip, FitBadge
├── components.json          # shadcn configuration
```
