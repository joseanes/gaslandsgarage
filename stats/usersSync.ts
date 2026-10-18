import {
  planAuthProfileSync,
  type AuthProfileSource,
  type ProfileDocument
} from '../app/src/lib/admin/profileShape.ts';

export const USERS_COLLECTION = 'users';

/** The slice of a Firebase Auth UserRecord the sync needs. */
export type AuthUserLike = {
  uid: string;
  email?: string;
  displayName?: string;
  metadata: { creationTime?: string; lastSignInTime?: string };
};

/**
 * Writes the sync needs; the publish job backs this with a Firestore BulkWriter, whose write
 * promises only settle once their batch is sent, so `flush` is called after every write is queued.
 */
export type ProfileWriter = {
  create(uid: string, data: ProfileDocument): Promise<unknown>;
  update(uid: string, data: Partial<ProfileDocument>): Promise<unknown>;
  flush?(): Promise<unknown>;
};

export type UsersSyncResult = { created: number; updated: number; unchanged: number; failed: number };

export function toProfileSource(user: AuthUserLike): AuthProfileSource {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    creationTime: user.metadata.creationTime ?? null,
    lastSignInTime: user.metadata.lastSignInTime ?? null
  };
}

/**
 * Upserts users/{uid} for every Auth user. Existing documents are only filled or moved forward
 * (see planAuthProfileSync); documents for users no longer in Auth are left alone.
 */
export async function syncUserProfiles(
  authUsers: AuthUserLike[],
  existing: Map<string, Record<string, unknown>>,
  writer: ProfileWriter,
  now: string
): Promise<UsersSyncResult> {
  const result: UsersSyncResult = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const writes: Promise<void>[] = [];
  for (const user of authUsers) {
    const plan = planAuthProfileSync(toProfileSource(user), existing.get(user.uid) ?? null, now);
    if (plan.op === 'none') {
      result.unchanged += 1;
      continue;
    }
    const write = plan.op === 'create' ? writer.create(user.uid, plan.data) : writer.update(user.uid, plan.data);
    writes.push(
      write.then(
        () => {
          result[plan.op === 'create' ? 'created' : 'updated'] += 1;
        },
        (error: unknown) => {
          result.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Could not ${plan.op} ${USERS_COLLECTION}/${user.uid}: ${message}`);
        }
      )
    );
  }
  await writer.flush?.();
  await Promise.all(writes);
  return result;
}
