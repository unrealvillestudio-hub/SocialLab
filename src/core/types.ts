// UNRLVL — SocialLab v1.0 Core Types

export type PlatformId =
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TIKTOK"
  | "LINKEDIN"
  | "YOUTUBE"
  | "THREADS";

export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type MediaType = "image" | "video" | "carousel" | "reel" | "story";

export interface Platform {
  id: PlatformId;
  label: string;
  icon: string;           // emoji fallback
  color: string;          // hex brand color
  maxChars: number;
  supportsMedia: MediaType[];
  requiresMedia: boolean;
  apiEndpoint: string;    // mock — real endpoint when ready
  authRequired: string;   // scope needed
}

export interface ScheduledPost {
  id: string;
  brandId: string;
  platform: PlatformId;
  copy: string;
  hashtags: string[];
  mediaUrls: string[];
  mediaType: MediaType | null;
  scheduledAt: string;    // ISO
  status: PostStatus;
  mockPostId?: string;
  publishedAt?: string;
  errorMsg?: string;
  createdAt: string;
  blueprintId?: string;   // BP_COPY ref if used
}

export interface PublishResult {
  success: boolean;
  mockPostId?: string;
  errorMsg?: string;
  platform: PlatformId;
}


