/**
 * Catalog identity: never merge arbitrary two locations because their labels match.
 * The stable identity is (category, provider, providerId). Curated demo rows
 * may be reused by a name match to preserve ratings from the V0.3 starter data.
 */
const norm = (value) => String(value ?? '').trim().toLocaleLowerCase();
export function findExistingCatalogItem(items, incoming) {
  if (!incoming || !incoming.category) return null;
  const sameCategory=items.filter(x=>x.category===incoming.category);
  if (incoming.provider && incoming.providerId) {
    const match=sameCategory.find(x=>x.provider===incoming.provider && x.providerItemId===incoming.providerId);
    if (match) return match;
  }
  const name=norm(incoming.name);
  if (!name) return null;
  // Legacy V0.3 curated rows: prefer them rather than forking old ratings.
  const legacy=sameCategory.find(x=>x.provider==='demo' && norm(x.name)===name);
  if (legacy) return legacy;
  // An independently created item is only a likely match with matching location/subtitle.
  const subtitle=norm(incoming.subtitle);
  return sameCategory.find(x=>!x.provider && norm(x.name)===name && norm(x.subtitle)===subtitle) || null;
}
