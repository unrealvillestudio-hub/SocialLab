// ─── BRANDS CONFIG — UNRLVL Ecosystem ───────────────────────────────────────
// v2.0 — Neurone Cosmética añadida (marca 10)
// Actualizar este archivo en: src/config/brands.ts de cada app

export type BrandId =
  | 'unrealilleStudio'
  | 'patriciaOsorioPersonal'
  | 'patriciaOsorioComunidad'
  | 'patriciaOsorioVizosSalon'
  | 'diamondDetails'
  | 'd7Herbal'
  | 'vivoseMask'
  | 'vizosCosmetics'
  | 'phas'
  | 'neuroneCosmetics'

export interface Brand {
  id: BrandId
  name: string
  shortName: string
  owner: string
  color: string
  secondaryColor?: string
  emoji: string
  description: string
  market: string
  channels: string[]
}

export const BRANDS: Record<BrandId, Brand> = {
  unrealilleStudio: {
    id: 'unrealilleStudio',
    name: 'Unreal>ille Studio',
    shortName: 'UNRLVL',
    owner: 'Sam',
    color: '#FFAB00',
    emoji: '⚡',
    description: 'Agencia inhouse — marketing, publicidad y estrategia',
    market: 'Miami, FL',
    channels: ['web', 'instagram', 'linkedin'],
  },
  patriciaOsorioPersonal: {
    id: 'patriciaOsorioPersonal',
    name: 'Patricia Osorio Personal',
    shortName: 'PO Personal',
    owner: 'Patricia Osorio',
    color: '#EC4899',
    emoji: '👩',
    description: 'Marca personal de Patricia Osorio',
    market: 'Miami, FL',
    channels: ['instagram', 'tiktok', 'youtube'],
  },
  patriciaOsorioComunidad: {
    id: 'patriciaOsorioComunidad',
    name: 'Patricia Osorio Comunidad',
    shortName: 'PO Comunidad',
    owner: 'Patricia Osorio',
    color: '#A855F7',
    emoji: '🌐',
    description: 'Comunidad y contenido educativo de PO',
    market: 'Miami, FL',
    channels: ['instagram', 'youtube', 'email'],
  },
  patriciaOsorioVizosSalon: {
    id: 'patriciaOsorioVizosSalon',
    name: 'Vizos Salon',
    shortName: 'Vizos',
    owner: 'Patricia Osorio',
    color: '#F59E0B',
    emoji: '✂️',
    description: 'Salón de belleza — servicios capilares premium',
    market: 'Miami, FL',
    channels: ['instagram', 'whatsapp', 'google'],
  },
  diamondDetails: {
    id: 'diamondDetails',
    name: 'Diamond Details',
    shortName: 'Diamond',
    owner: 'Sam',
    color: '#3B82F6',
    emoji: '💎',
    description: 'Detailing de autos premium',
    market: 'Miami, FL',
    channels: ['instagram', 'google', 'whatsapp'],
  },
  d7Herbal: {
    id: 'd7Herbal',
    name: 'D7 Herbal',
    shortName: 'D7',
    owner: 'Sam',
    color: '#22C55E',
    emoji: '🌿',
    description: 'Gel bebible natural — Asaí, Espirulina, Fruto del Monje',
    market: 'Miami, FL',
    channels: ['instagram', 'tiktok', 'shopify'],
  },
  vivoseMask: {
    id: 'vivoseMask',
    name: 'Vivose Mask',
    shortName: 'Vivose',
    owner: 'Sam',
    color: '#F472B6',
    emoji: '🌸',
    description: 'Mascarillas y skincare natural',
    market: 'Miami, FL',
    channels: ['instagram', 'tiktok', 'shopify'],
  },
  vizosCosmetics: {
    id: 'vizosCosmetics',
    name: 'Vizos Cosmetics',
    shortName: 'Vizos Co.',
    owner: 'Sam',
    color: '#6366F1',
    emoji: '💄',
    description: 'Cosméticos y maquillaje',
    market: 'Miami, FL',
    channels: ['instagram', 'tiktok', 'shopify'],
  },
  phas: {
    id: 'phas',
    name: 'PHAS',
    shortName: 'PHAS',
    owner: 'Sam',
    color: '#14B8A6',
    emoji: '🔬',
    description: 'Productos de salud y bienestar',
    market: 'Miami, FL',
    channels: ['web', 'amazon', 'shopify'],
  },
  neuroneCosmetics: {
    id: 'neuroneCosmetics',
    name: 'Neurone Cosmética',
    shortName: 'Neurone',
    owner: 'Patricia Osorio',
    color: '#0076A8',
    secondaryColor: '#000000',
    emoji: '💙',
    description: 'Distribución exclusiva South & Central Miami — Neurocosmética + Nano Tribología. B2C + Portal Pro B2B para profesionales.',
    market: 'South & Central Miami, FL',
    channels: ['shopify', 'instagram', 'whatsapp', 'b2b-portal'],
  },
}

export const BRAND_LIST = Object.values(BRANDS)
export const BRAND_IDS = Object.keys(BRANDS) as BrandId[]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

export const getBrandById = (id: string): Brand | undefined =>
  BRANDS[id as BrandId]

export const getBrandColor = (id: string): string =>
  BRANDS[id as BrandId]?.color ?? '#FFAB00'

export const getBrandName = (id: string): string =>
  BRANDS[id as BrandId]?.name ?? id
