import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);
const ownerPath = 'users/alice/vehicle-photos/team1234/veh123/photo1234.webp';

beforeAll(async () => {
	testEnv = await initializeTestEnvironment({
		projectId: 'demo-gaslands-rules',
		firestore: {
			rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
			host: '127.0.0.1',
			port: 8080
		},
		storage: {
			rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
			host: '127.0.0.1',
			port: 9199
		}
	});
});

afterAll(async () => {
	await testEnv.cleanup();
});

beforeEach(async () => {
	await testEnv.clearFirestore();
	await testEnv.clearStorage();
});

function file(uid: string | null, path: string) {
	const context = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
	return ref(context.storage(), path);
}

describe('vehicle photo storage', () => {
	it('lets the owner upload and read a webp or jpeg under 1.5 MiB', async () => {
		await assertSucceeds(uploadBytes(file('alice', ownerPath), webp, { contentType: 'image/webp' }));
		await assertSucceeds(getBytes(file('alice', ownerPath)));
		const jpegPath = 'users/alice/vehicle-photos/team1234/veh123/photo1234.jpg';
		await assertSucceeds(uploadBytes(file('alice', jpegPath), webp, { contentType: 'image/jpeg' }));
	});

	it('denies other people, signed-out readers, other paths, png, and oversized files', async () => {
		await assertSucceeds(uploadBytes(file('alice', ownerPath), webp, { contentType: 'image/webp' }));
		await assertFails(getBytes(file('bob', ownerPath)));
		await assertFails(getBytes(file(null, ownerPath)));
		await assertFails(deleteObject(file('bob', ownerPath)));
		await assertFails(uploadBytes(file('alice', 'users/alice/notes/photo1234.webp'), webp, { contentType: 'image/webp' }));
		await assertFails(uploadBytes(file('alice', ownerPath.replace('.webp', '.png')), webp, { contentType: 'image/png' }));
		await assertFails(
			uploadBytes(file('alice', 'users/alice/vehicle-photos/team1234/veh123/photo9999.webp'), new Uint8Array(1_572_865), {
				contentType: 'image/webp'
			})
		);
		await assertSucceeds(deleteObject(file('alice', ownerPath)));
	});
});

describe('shared photo storage', () => {
	const photoId = 'photoshare1';
	const sharedPath = `shared-photos/${photoId}`;

	async function seedShared(input: {
		hidden?: boolean;
		published?: boolean;
		showInGallery?: boolean;
		showOnShareLink?: boolean;
		showToBuddies?: boolean;
		buddy?: boolean;
		admin?: boolean;
	}) {
		await testEnv.withSecurityRulesDisabled(async (context) => {
			const database = context.firestore();
			await setDoc(doc(database, 'sharedPhotos', photoId), {
				photoId,
				displayName: 'Track Name',
				vehicleType: 'Car',
				teamName: '',
				caption: '',
				createdAt: '2026-10-19T00:00:00.000Z',
				hidden: input.hidden === true,
				published: input.published !== false,
				showInGallery: input.showInGallery !== false
			});
			await setDoc(doc(database, 'sharedPhotoPrivate', photoId), {
				ownerUid: 'alice',
				hidden: input.hidden === true,
				published: input.published !== false,
				showInGallery: input.showInGallery !== false,
				showOnShareLink: input.showOnShareLink === true,
				showToBuddies: input.showToBuddies === true
			});
			if (input.buddy) {
				await setDoc(doc(database, 'buddies', 'alice~buddy'), { status: 'accepted', members: ['alice', 'buddy'] });
			}
			if (input.admin) {
				await setDoc(doc(database, 'roles', 'admin'), { role: 'Administrator' });
			}
			await uploadBytes(ref(context.storage(), sharedPath), webp, { contentType: 'image/webp' });
		});
	}

	it('lets the public read a visible gallery photo and denies writes', async () => {
		await seedShared({});
		await assertSucceeds(getBytes(file(null, sharedPath)));
		await assertFails(uploadBytes(file('alice', sharedPath), webp, { contentType: 'image/webp' }));
		await assertFails(deleteObject(file('alice', sharedPath)));
	});

	it('hides a photo from the public when it is hidden, and still lets an admin read it', async () => {
		await seedShared({ hidden: true, admin: true });
		await assertFails(getBytes(file(null, sharedPath)));
		await assertFails(getBytes(file('buddy', sharedPath)));
		await assertSucceeds(getBytes(file('admin', sharedPath)));
	});

	it('lets a share link read a photo that is not in the gallery', async () => {
		await seedShared({ published: false, showInGallery: false, showOnShareLink: true });
		await assertSucceeds(getBytes(file(null, sharedPath)));
	});

	it('lets an accepted buddy read a buddy photo and denies everyone else', async () => {
		await seedShared({ published: false, showInGallery: false, showToBuddies: true, buddy: true });
		await assertFails(getBytes(file(null, sharedPath)));
		await assertFails(getBytes(file('stranger', sharedPath)));
		await assertSucceeds(getBytes(file('buddy', sharedPath)));
	});
});
