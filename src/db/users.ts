import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
}) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        displayName: params.displayName || 'Creator',
        photoUrl: params.photoUrl || '',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          ...(params.displayName ? { displayName: params.displayName } : {}),
          ...(params.photoUrl ? { photoUrl: params.photoUrl } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database error in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in getUserByUid:', error);
    throw new Error('Failed to load user profile.', { cause: error });
  }
}

export async function updateUserPreferences(
  userId: number,
  displayName: string,
  preferencesJson: string
) {
  try {
    const rows = await db
      .update(users)
      .set({ displayName, preferencesJson })
      .where(eq(users.id, userId))
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database error in updateUserPreferences:', error);
    throw new Error('Failed to save user settings.', { cause: error });
  }
}

export async function deductUserCredits(userId: number, amount: number) {
  try {
    const rows = await db
      .update(users)
      .set({
        credits: sql`GREATEST(0, ${users.credits} - ${Math.max(0, Math.round(amount))})`,
      })
      .where(eq(users.id, userId))
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database error in deductUserCredits:', error);
    throw new Error('Failed to update processing credits.', { cause: error });
  }
}
