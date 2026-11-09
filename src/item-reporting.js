const METADATA_COVERAGE =
  "Metadata purchase-history entries; full refunds are not identified.";

const isMetadataPurchase = (purchase) =>
  purchase.source === "metadata" ||
  String(purchase.id || "").startsWith("metadata:");

// The upstream upgrade materialization excludes non-purchases and corrupted
// upgrades (upgrade_info bit 23). The opaque flags field is not a refund signal.
// https://github.com/deadlock-api/deadlock-api/blob/4b8df080e364c3926428a060e22b09636cbd5fdb/db/clickhouse/default/match_player.sql#L231-L236
export function isMetadataItemPick(purchase) {
  return (
    Number.isFinite(purchase.gameTime) &&
    purchase.gameTime > 0 &&
    (!Number.isInteger(purchase.upgradeInfo) ||
      (purchase.upgradeInfo & 8388608) === 0)
  );
}

// Apply on reads as well as new imports so existing archives need no individual
// review. Keep the live transaction ledger and explicit operator refunds intact.
export function automaticItemHistory(session) {
  const items = session.items;
  if (
    !items ||
    !(
      session.mode === "offline" ||
      session.offline ||
      session.result?.captureMode === "offline"
    )
  )
    return items;
  const purchases = (items.purchases || [])
    .filter((purchase) =>
      isMetadataPurchase(purchase) ? isMetadataItemPick(purchase) : true,
    )
    .map((purchase) => {
      if (
        !isMetadataPurchase(purchase) ||
        ["confirmed", "refunded"].includes(purchase.status)
      )
        return purchase;
      return {
        ...purchase,
        source: "metadata",
        status: "recorded",
        evidence:
          "Metadata purchase-history entry; refund outcome is not provided",
      };
    });
  return {
    ...items,
    purchases,
    reviewCount: purchases.filter((p) => p.status === "review").length,
    reportBasis: "recorded-item-picks",
    coverage: METADATA_COVERAGE,
  };
}

export function itemReportDetails(games, baseline = []) {
  const all = [...games, ...baseline];
  const metadata = (game) =>
    game.reportBasis === "recorded-item-picks" ||
    (game.purchases || []).some(isMetadataPurchase);
  if (!all.some(metadata))
    return {
      reportBasis: "verified-purchases",
      metricLabel: "Confirmed purchases",
      coverage: "Confirmed recorded purchases; known full refunds excluded.",
    };
  return {
    reportBasis: "recorded-item-picks",
    metricLabel: "Recorded item picks",
    coverage: all.some((game) => !metadata(game))
      ? `${METADATA_COVERAGE} Live recordings count confirmed purchases after refund checks.`
      : METADATA_COVERAGE,
  };
}
