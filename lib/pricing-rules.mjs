// Persist deletion markers so bundled defaults and scheduled sync cannot resurrect a rule.
export function mergePricingRules(defaults, initialGroups, saved = {}) {
  const deletedGroupIds = [...new Set(saved.deletedGroupIds || [])];
  const deleted = new Set(deletedGroupIds);
  return {
    products: { ...defaults.products, ...saved.products },
    classes: { ...defaults.classes, ...saved.classes },
    groups: [
      ...initialGroups.filter(
        (g) => !(saved.groups || []).some((x) => x.id === g.id),
      ),
      ...(saved.groups || []),
    ].filter((g) => !deleted.has(g.id)),
    deletedGroupIds,
  };
}

export function deletePricingRule(rules, scope, code) {
  rules[scope][code] = { disabled: true, deleted: true };
}

export function deletePromotion(rules, id) {
  if (!rules.groups.some((g) => g.id === id))
    throw Error('找不到活動，請重新載入');
  rules.groups = rules.groups.filter((g) => g.id !== id);
  rules.deletedGroupIds = [...new Set([...(rules.deletedGroupIds || []), id])];
}

export function mergeSyncedPromotions(rules, incoming, restoreDeleted = false) {
  const deletedGroupIds = (rules.deletedGroupIds || []).filter(
    (id) => !restoreDeleted || !id.startsWith('website-bogo-'),
  );
  const deleted = new Set(deletedGroupIds);
  const overrides = new Map(
    rules.groups.filter((g) => g.origin !== 'website').map((g) => [g.id, g]),
  );
  const removed = rules.groups
    .filter(
      (g) => g.origin === 'website' && !incoming.some((n) => n.id === g.id),
    )
    .map((g) => ({ ...g, disabled: true }));
  return {
    ...rules,
    deletedGroupIds,
    groups: [
      ...incoming.filter((g) => !overrides.has(g.id)),
      ...removed,
      ...overrides.values(),
    ].filter((g) => !deleted.has(g.id)),
  };
}
