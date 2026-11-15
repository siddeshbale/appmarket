import type { CategoryScope, ChartType, Device, Platform } from '../../shared/types';

export interface ProviderInfo {
  id: string;
  name: string;
  platform: Platform | 'multi';
  /** enabled = used by ingestion; optional = available but off by default; unsupported = documented gap with fallback */
  status: 'enabled' | 'optional' | 'unsupported';
  capabilities: {
    charts?: { chartTypes: ChartType[]; devices: Device[]; categoryCharts: boolean; maxDepth: number; depthOptions?: number[] };
    lookup?: boolean;
    search?: boolean;
    fields: string[];
  };
  markets: 'registry' | string[];
  docsUrl: string | null;
  termsUrl: string | null;
  rateLimit: string;
  intendedUse: string;
  publicExportFields: string[];
  limitations: string[];
}

export interface ChartEntryNorm {
  rank: number;
  storeId: string;
  title: string;
  publisherName: string | null;
  publisherStoreId: string | null;
  publisherUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  currency: string | null;
  releaseDate: string | null;
  iconUrl: string | null;
  url: string | null;
  bundleId?: string | null;
}

export interface ChartNorm {
  provider: string;
  platform: Platform;
  market: string;
  device: Device;
  chartType: ChartType;
  category: string; // 'all' or store category id
  categoryScope: CategoryScope;
  requestedDepth: number;
  snapshotDay: string;
  fetchedAt: string;
  sourceUrl: string;
  entries: ChartEntryNorm[];
}

export interface ListingNorm {
  platform: Platform;
  storeId: string;
  market: string;
  language: string | null;
  availability: 'available' | 'unavailable';
  title: string | null;
  subtitle?: string | null;
  description: string | null;
  publisherName: string | null;
  publisherStoreId: string | null;
  publisherUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isGame: boolean | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  ratingCount: number | null;
  ratingScope: string | null;
  version: string | null;
  storeUpdatedAt: string | null;
  releaseDate: string | null;
  iconUrl: string | null;
  installBand: string | null;
  installLowerBound: number | null;
  hasAds: boolean | null;
  hasIap: boolean | null;
  contentRating: string | null;
  sourceUrl: string;
  bundleId?: string | null;
}

export class MalformedPayloadError extends Error {}
