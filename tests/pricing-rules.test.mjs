import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePricingRules,
  deletePricingRule,
  deletePromotion,
  mergeSyncedPromotions,
} from '../lib/pricing-rules.mjs';
import { composeCatalogProduct } from '../lib/catalog.mjs';
import { resolveProductPricing } from '../lib/pos-core.mjs';
import { applyPromotions } from '../lib/promotions.mjs';
import { syncPromotions } from '../lib/shop-sync.mjs';

const product = {
  code: 'A',
  name: '書',
  price: 100,
  class: '01',
  specialDiscount: 79,
  defaultDiscount: 88,
};
const defaults = {
  products: { A: { mode: 'discount', value: 79 } },
  classes: { '01': { mode: 'discount', value: 88 } },
};
const webGroup = {
  id: 'website-bogo-A',
  name: '官網',
  origin: 'website',
  type: 'bogo',
  codes: ['A'],
  giftCode: 'A',
  giftMode: 'scanned',
  priority: 100,
};
const custom = {
  id: 'custom',
  name: '數量折扣',
  origin: 'custom',
  type: 'tiers',
  codes: ['A'],
  tiers: [{ quantity: 1, mode: 'discount', value: 50 }],
  priority: 0,
};
const reload = (rules) =>
  mergePricingRules(defaults, [webGroup], JSON.parse(JSON.stringify(rules)));

test('Deleted legacy single and category survive reload and fall back through existing price priority', () => {
  const rules = mergePricingRules(defaults, [], {});
  deletePricingRule(rules, 'products', 'A');
  let next = reload(rules);
  assert.equal(
    resolveProductPricing(
      composeCatalogProduct(product, { websitePrice: 60 }, next),
    ).priceSource,
    'website',
  );
  assert.equal(
    resolveProductPricing(composeCatalogProduct(product, null, next))
      .defaultDiscount,
    88,
  );
  deletePricingRule(next, 'classes', '01');
  next = reload(next);
  assert.equal(
    resolveProductPricing(composeCatalogProduct(product, null, next))
      .defaultDiscount,
    100,
  );
  assert.equal(
    resolveProductPricing(composeCatalogProduct(product, null, next))
      .priceSource,
    'original',
  );
});

test('Deleting groups removes them from lists and checkout after persistence and sync', () => {
  const rules = mergePricingRules(defaults, [webGroup], { groups: [custom] });
  deletePromotion(rules, webGroup.id);
  deletePromotion(rules, custom.id);
  const next = mergeSyncedPromotions(reload(rules), [webGroup]);
  assert.deepEqual(next.groups, []);
  const item = { ...product, quantity: 2, discount: 100 };
  assert.ok(
    applyPromotions([item], [product], next.groups).every(
      (i) => !i.promotionGift && i.discount === 100,
    ),
  );
  assert.throws(() => deletePromotion(next, 'missing'), /找不到/);
});

test('Sync preserves manual overrides and deletions; explicit restore only restores website deletions', () => {
  const override = {
    ...webGroup,
    origin: 'custom',
    name: '書房修改',
    disabled: true,
  };
  const rules = {
    products: {},
    classes: {},
    groups: [override, custom],
    deletedGroupIds: ['website-bogo-B', 'custom-deleted'],
  };
  const incoming = [webGroup, { ...webGroup, id: 'website-bogo-B' }];
  const normal = mergeSyncedPromotions(rules, incoming);
  assert.equal(
    normal.groups.find((g) => g.id === webGroup.id).name,
    '書房修改',
  );
  assert.equal(
    normal.groups.some((g) => g.id === 'website-bogo-B'),
    false,
  );
  const restored = mergeSyncedPromotions(normal, incoming, true);
  assert.equal(
    restored.groups.some((g) => g.id === 'website-bogo-B'),
    true,
  );
  assert.deepEqual(restored.deletedGroupIds, ['custom-deleted']);
  assert.deepEqual(
    restored.groups.find((g) => g.id === 'custom'),
    custom,
  );
});

test('Scheduled promotion sync persists deletion markers and rejects a concurrent pricing edit', async () => {
  const rules = {
    products: {},
    classes: {},
    groups: [],
    deletedGroupIds: [webGroup.id],
    revision: 'r1',
  };
  let saved = JSON.stringify(rules);
  const db = {
    prepare() {
      return {
        bind(value, before) {
          this.value = value;
          this.before = before;
          return this;
        },
        async first() {
          return { value: saved };
        },
        async run() {
          if (saved !== this.before) return { meta: { changes: 0 } };
          saved = this.value;
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  const fetcher = async () =>
    Response.json({
      total_count: 1,
      total_pages: 1,
      products: [{ first_variant_sku: 'A', variants_info: '贈A1' }],
    });
  // Official parser requires real code-shaped gifts.
  const config = {
    rules,
    pricingRevision: 'r1',
    products: [product, { code: 'A1' }],
  };
  const result = await syncPromotions(db, config, fetcher);
  assert.equal(result.count, 0);
  assert.equal(result.suppressed, 1);
  assert.deepEqual(JSON.parse(saved).groups, []);
  assert.deepEqual(JSON.parse(saved).deletedGroupIds, [webGroup.id]);
  await assert.rejects(syncPromotions(db, config, fetcher), /正在修改/);
});
