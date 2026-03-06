import { create } from 'zustand';
import { ScheduledPost, PostStatus } from '../core/types';

interface PostStore {
  posts: ScheduledPost[];
  addPost: (post: ScheduledPost) => void;
  updatePost: (id: string, updates: Partial<ScheduledPost>) => void;
  removePost: (id: string) => void;
  getByBrand: (brandId: string) => ScheduledPost[];
  getByStatus: (status: PostStatus) => ScheduledPost[];
  getByMonth: (year: number, month: number) => ScheduledPost[];
}

// Seed with a few demo posts
const DEMO_POSTS: ScheduledPost[] = [
  {
    id: "demo_001",
    brandId: "patriciaOsorioPersonal",
    platform: "INSTAGRAM",
    copy: "✨ 3 errores que cometes al hacer balayage en casa (y cómo evitarlos). Hilo 👇",
    hashtags: ["balayage", "cabellorubio", "miamihair", "PatriciaOsorio"],
    mediaUrls: [],
    mediaType: "image",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    status: "scheduled",
    createdAt: new Date().toISOString(),
    blueprintId: "copy_po_personal",
  },
  {
    id: "demo_002",
    brandId: "diamondDetails",
    platform: "INSTAGRAM",
    copy: "¿Sabes qué le pasa a tu pintura sin protección cerámica? Te mostramos antes y después real. 💎",
    hashtags: ["detailing", "ceramiccoating", "diamonddetails", "Alicante"],
    mediaUrls: [],
    mediaType: "reel",
    scheduledAt: new Date(Date.now() + 172800000).toISOString(),
    status: "scheduled",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo_003",
    brandId: "d7Herbal",
    platform: "FACEBOOK",
    copy: "Tu cabello habla antes que tú. Dale lo que necesita con nuestra fórmula botánica.",
    hashtags: ["D7Herbal", "cuidadocapilar", "natural"],
    mediaUrls: [],
    mediaType: "image",
    scheduledAt: new Date(Date.now() - 86400000).toISOString(),
    status: "published",
    mockPostId: "FB_DEMO_ABC123",
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

export const usePostStore = create<PostStore>((set, get) => ({
  posts: DEMO_POSTS,

  addPost: (post) => set(state => ({ posts: [...state.posts, post] })),

  updatePost: (id, updates) => set(state => ({
    posts: state.posts.map(p => p.id === id ? { ...p, ...updates } : p)
  })),

  removePost: (id) => set(state => ({ posts: state.posts.filter(p => p.id !== id) })),

  getByBrand: (brandId) => get().posts.filter(p => p.brandId === brandId),

  getByStatus: (status) => get().posts.filter(p => p.status === status),

  getByMonth: (year, month) => get().posts.filter(p => {
    const d = new Date(p.scheduledAt);
    return d.getFullYear() === year && d.getMonth() === month;
  }),
}));
