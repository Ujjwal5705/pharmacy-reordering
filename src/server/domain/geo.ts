export type Point = { lat: number; lng: number };

/** Great-circle distance in km. Prototype assumption: straight-line distance stands in for travel time. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type StoreCandidate = { storeId: string; point: Point; available: Map<string, number> };
export type RouteNeed = { productId: string; quantity: number };

export function rankStoresByDistance<T extends { point: Point }>(origin: Point, stores: T[]) {
  return stores
    .map((s) => ({ ...s, distanceKm: haversineKm(origin, s.point) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Nearest store that can fulfil every line in full. Orders are never split across stores;
 * null means no single store can fulfil the order.
 */
export function chooseNearestFulfillingStore(origin: Point, stores: StoreCandidate[], needs: RouteNeed[]) {
  for (const s of rankStoresByDistance(origin, stores)) {
    if (needs.every((n) => (s.available.get(n.productId) ?? 0) >= n.quantity)) {
      return { storeId: s.storeId, distanceKm: s.distanceKm };
    }
  }
  return null;
}
