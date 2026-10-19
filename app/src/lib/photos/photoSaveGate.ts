import type { PhotoSaveReason } from './saveBeforePhoto';

export const PHOTO_SAVE_GATE = Symbol('gaslands-photo-save-gate');

export type PhotoAttachIntent = 'file' | 'library';

export type PhotoAttachRequest = {
	vehicleId: string;
	intent: PhotoAttachIntent;
	file?: File;
	caption?: string;
	uploadGallery?: boolean;
	uploadStats?: boolean;
	photoId?: string;
};

export type PhotoSaveGate = {
	reason(vehicleId: string): PhotoSaveReason | null;
	request(detail: PhotoAttachRequest): void;
	listen(vehicleId: string, resume: (detail: PhotoAttachRequest) => void | Promise<void>): () => void;
};
