// R15b BB-2: Dedicated Server Component for listing JSON-LD.
// Renders the <script type="application/ld+json"> exactly once.
// Previously inlined in page.tsx, PPR duplicated it (two byte-identical
// streamed chunks). A separate component with no client boundary
// ancestors renders in the static shell.
export function ListingJsonLd({ json }: { json: string }) {
  if (!json) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
