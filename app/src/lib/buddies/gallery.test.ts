import { describe, expect, it } from 'vitest';
import { galleryBuddyContext, galleryBuddyLabel } from './gallery';

describe('gallery buddy copy', () => {
	it('uses the request states and the painted-car sentence', () => {
		expect(galleryBuddyLabel('sign-in')).toBe('Sign in to add as buddy');
		expect(galleryBuddyLabel('add')).toBe('Add as buddy');
		expect(galleryBuddyLabel('sent')).toBe('Request sent');
		expect(galleryBuddyLabel('buddies')).toBe('Buddies ✓');
		expect(galleryBuddyLabel('accept')).toBe('Accept buddy request');
		expect(galleryBuddyLabel('declined')).toBe('Request declined');
		expect(galleryBuddyLabel('hidden')).toBe('');
		expect(galleryBuddyContext('Rust Rocket')).toBe('found you through your painted car: Rust Rocket');
		expect(galleryBuddyContext('ada@example.com')).toBe('found you through your painted car: painted car');
	});
});
