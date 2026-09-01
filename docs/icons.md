# Icons

The service glyphs in `src/icons/index.tsx` are original line drawings, not
AWS's official [Architecture Icons][aws-icons]. That pack is distributed under
its own terms, so it is not vendored into this repository — swapping it in is a
decision for whoever deploys this.

## How icons resolve

Each entry in `src/model/registry.ts` names an `IconKey`:

```ts
{
  canonical: 'lambda.function',
  icon: 'lambda',
  category: 'compute',
  ...
}
```

`ServiceIcon` looks that key up in the `glyphs` map and renders a 24×24 SVG that
draws with `currentColor`, so the node component can tint it by category. An
unrecognized key falls back to the `generic` glyph, and a resource with no
registry entry at all still renders — as a labelled box carrying its raw type.

## Using the official AWS pack

1. Download the Architecture Icons package from AWS and read its terms.
2. Drop the SVGs you need somewhere under `src/icons/aws/`.
3. Replace the entries in the `glyphs` map with components that render them.
   Keep the 24×24 viewBox and `currentColor` if you want category tinting to
   keep working; if you use the official multi-color art instead, drop the
   `color: var(--tint)` rule from `.rf-node .glyph` in `src/index.css` so the
   artwork's own colors show through.

Nothing else needs to change: `IconKey` is the only contract between the
registry and the rendering.

## Adding a glyph for a new service

Add the key to the `IconKey` union, add a matching entry to `glyphs`, and point
the registry entry at it. Glyphs are deliberately simple — a recognizable
silhouette at 22px is worth more than detail that disappears at that size.

[aws-icons]: https://aws.amazon.com/architecture/icons/
