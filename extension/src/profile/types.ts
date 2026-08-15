export type PhotoRole =
  | "face_front" | "face_left" | "face_right"
  | "upper_body_front" | "upper_body_side"
  | "full_body_front" | "full_body_side"
  | "left_hand_wrist" | "right_hand_wrist"
  | "feet_front" | "feet_side_top";

export type RequirementKey =
  | "face_front" | "upper_body_front" | "full_body_front"
  | "hand_wrist" | "feet_front";

export type ProfileAssetMetadata = {
  role: PhotoRole;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byte_size: number;
  updated_at: string;
};

export type ProfileAttributes = {
  height_cm?: number;
  top_size?: string;
  bottom_size?: string;
  dress_size?: string;
  chest_cm?: number;
  waist_cm?: number;
  hips_cm?: number;
  inseam_cm?: number;
  skin_tone?: string;
  undertone?: string;
  shoe_size_system?: string;
  shoe_size?: string;
  ring_size?: string;
  left_wrist_cm?: number;
  right_wrist_cm?: number;
};

export type ProfileMetadata = {
  version: 2;
  consented_at: string;
  assets: Partial<Record<PhotoRole, ProfileAssetMetadata>>;
  attributes: ProfileAttributes;
};

export type PreparedProfileImage = {
  blob: Blob;
  metadata: ProfileAssetMetadata;
};

export type ProfileAssetUpload = {
  kind: PhotoRole;
  image_data_url: string;
};
