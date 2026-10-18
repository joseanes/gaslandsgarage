import { writable } from 'svelte/store';
import { auth, db } from '../firebase';
import { browser } from '$app/environment';
import {
	stampNewsletterConsent,
	stampReceiveUpdatesConsent,
	type NewsletterConsentFields
} from '../privacy/marketingConsent';

// Interface for user settings
export interface UserSettings {
  enableSponsorships: boolean;
  includeAdvanced: boolean;
  darkMode: boolean;
  printStyle?: string;
  showTeamSummary?: boolean;
  showGaslandsMath?: boolean;
  hasRules?: boolean; // Indicates if the user has acknowledged owning the rules
  showExperimentalFeatures?: boolean; // Whether to show experimental features
  receiveUpdates?: boolean; // Whether user wants to receive updates and marketing emails
  receiveUpdatesChangedAt?: string; // When receiveUpdates was last turned on or off
  newsletterOptIn?: boolean; // Monthly email. Absent until the player answers. Unchecked by default.
  newsletterOptInAt?: string; // When newsletterOptIn was last turned on
  newsletterOptOutAt?: string; // When newsletterOptIn was last turned off
  newsletterConsentText?: string; // Consent copy version, for example monthly-email-v1
  newsletterPromptDismissedAt?: string; // When the one-time prompt was dismissed without answering
  newsletterSource?: string; // Where the latest monthly-email choice was recorded, for example profile
  showOnPlayersMap?: boolean; // Whether to show on the Gaslands Players map
  allowContactFromPlayers?: boolean; // Whether other players can contact for game setup
  location?: string; // User's location for the players map
  showEquipmentDescriptions?: boolean; // Whether to show equipment descriptions in printouts
  showPerkDescriptions?: boolean; // Whether to show perk descriptions in printouts
  showSpecialRules?: boolean; // Whether to show vehicle special rules in printouts
}

// Default settings
export const DEFAULT_SETTINGS: UserSettings = {
  enableSponsorships: true,
  includeAdvanced: true,
  darkMode: false,
  printStyle: 'classic',
  showTeamSummary: true,
  showGaslandsMath: true,
  hasRules: false, // Default to false until acknowledged
  showExperimentalFeatures: false, // Default to not showing experimental features
  receiveUpdates: false, // Default to not receiving updates
  showOnPlayersMap: false, // Default to not showing on players map
  allowContactFromPlayers: false, // Default to not allowing contact
  location: '', // Default to empty location
  showEquipmentDescriptions: true, // Default to showing equipment descriptions
  showPerkDescriptions: true, // Default to showing perk descriptions
  showSpecialRules: true // Default to showing special rules
};

export interface NewsletterView {
  loaded: boolean;
  optIn: boolean;
  answered: boolean;
  dismissed: boolean;
  optInAt: string | null;
}

export const newsletterView = writable<NewsletterView>({
  loaded: false,
  optIn: false,
  answered: false,
  dismissed: false,
  optInAt: null
});

/** Last settings read or saved for the signed-in player. Null when signed out. */
export const accountSettings = writable<UserSettings | null>(null);

export function newsletterViewFrom(settings: NewsletterConsentFields | null | undefined, loaded: boolean): NewsletterView {
  const dismissedAt = settings?.newsletterPromptDismissedAt;
  const optInAt = settings?.newsletterOptInAt;
  return {
    loaded,
    optIn: settings?.newsletterOptIn === true,
    answered: typeof settings?.newsletterOptIn === 'boolean',
    dismissed: typeof dismissedAt === 'string' && dismissedAt.length > 0,
    optInAt: typeof optInAt === 'string' && optInAt ? optInAt : null
  };
}

function publishNewsletter(settings: NewsletterConsentFields | null | undefined, loaded: boolean) {
  newsletterView.set(newsletterViewFrom(settings, loaded));
}

/** Hide the prompt until the signed-in player's settings have been read. */
export function resetNewsletterView() {
  newsletterView.set({ loaded: false, optIn: false, answered: false, dismissed: false, optInAt: null });
  accountSettings.set(null);
}

/**
 * Save user settings to Firestore
 */
export async function saveUserSettings(settings: UserSettings): Promise<{ success: boolean; error?: any }> {
  try {
    const currentAuth = auth;
    const database = db;
    if (!browser) return { success: false, error: 'Not in browser environment' };
    if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated' };

    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const userId = currentAuth.currentUser.uid;
    const settingsRef = doc(database, 'userSettings', userId);
    const existing = await getDoc(settingsRef);
    const previous = existing.exists() ? (existing.data() as UserSettings) : null;
    const now = new Date().toISOString();
    const stamped = stampNewsletterConsent(
      previous,
      stampReceiveUpdatesConsent(previous, settings, now),
      now
    );
    await setDoc(settingsRef, stamped);
    publishNewsletter(stamped, true);
    accountSettings.set(stamped);
    return { success: true };
  } catch (error) {
    console.error('Error saving user settings:', error);
    return { success: false, error };
  }
}

/**
 * Get user settings from Firestore, create defaults if none exist
 */
export async function getUserSettings(): Promise<{ success: boolean; settings?: UserSettings; error?: any }> {
  try {
    const currentAuth = auth;
    const database = db;
    if (!browser) return { success: false, error: 'Not in browser environment', settings: DEFAULT_SETTINGS };
    if (!currentAuth?.currentUser || !database) {
      resetNewsletterView();
      return { success: false, error: 'User not authenticated', settings: DEFAULT_SETTINGS };
    }

    const { doc, getDoc, runTransaction } = await import('firebase/firestore');
    const userId = currentAuth.currentUser.uid;
    console.log("Getting settings for user:", userId);
    const settingsRef = doc(database, 'userSettings', userId);
    const settingsSnapshot = await getDoc(settingsRef);
    
    if (settingsSnapshot.exists()) {
      const data = settingsSnapshot.data() as UserSettings;
      console.log("Retrieved user settings from Firebase:", data, "printStyle:", data.printStyle);
      
      // Ensure printStyle is preserved (defensive coding)
      if (!data.printStyle && DEFAULT_SETTINGS.printStyle) {
        console.log("No printStyle in Firebase data, using default:", DEFAULT_SETTINGS.printStyle);
        data.printStyle = DEFAULT_SETTINGS.printStyle;
      }

      publishNewsletter(data, true);
      accountSettings.set(data);
      return { success: true, settings: data };
    } else {
      // Create default settings if none exist. A transaction avoids wiping a choice
      // saved while this first read was still in flight.
      console.log("No settings found for user, creating defaults");
      await runTransaction(database, async (tx) => {
        const current = await tx.get(settingsRef);
        if (current.exists()) return;
        tx.set(settingsRef, DEFAULT_SETTINGS);
      });
      const created = await getDoc(settingsRef);
      const data = (created.exists() ? created.data() : DEFAULT_SETTINGS) as UserSettings;
      publishNewsletter(data, true);
      accountSettings.set(data);
      return { success: true, settings: data };
    }
  } catch (error) {
    console.error('Error getting user settings:', error);
    return { success: false, error, settings: DEFAULT_SETTINGS };
  }
}

async function writeOwnSettings(next: NewsletterConsentFields): Promise<{ success: boolean; error?: unknown }> {
  const currentAuth = auth;
  const database = db;
  if (!browser) return { success: false, error: 'Not in browser environment' };
  if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated' };

  const { doc, setDoc } = await import('firebase/firestore');
  const settingsRef = doc(database, 'userSettings', currentAuth.currentUser.uid);
  await setDoc(settingsRef, next);
  publishNewsletter(next, true);
  accountSettings.set(next as unknown as UserSettings);
  return { success: true };
}

/** Opt in or out of the monthly email without changing the other settings. */
export async function saveNewsletterChoice(
  optIn: boolean,
  source?: 'profile' | 'prompt' | 'settings'
): Promise<{ success: boolean; error?: unknown }> {
  try {
    const currentAuth = auth;
    const database = db;
    if (!browser) return { success: false, error: 'Not in browser environment' };
    if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated' };

    const { doc, getDoc } = await import('firebase/firestore');
    const settingsRef = doc(database, 'userSettings', currentAuth.currentUser.uid);
    const existing = await getDoc(settingsRef);
    const previous = existing.exists() ? (existing.data() as UserSettings) : null;
    const carried = { ...(previous ?? {}) };
    delete carried.newsletterSource;
    const stamped = stampNewsletterConsent(
      previous,
      source ? { ...carried, newsletterOptIn: optIn, newsletterSource: source } : { ...carried, newsletterOptIn: optIn },
      new Date().toISOString()
    );
    return await writeOwnSettings(stamped);
  } catch (error) {
    console.error('Error saving newsletter choice:', error);
    return { success: false, error };
  }
}

/** Remember that the one-time prompt was closed. This is not a yes or a no. */
export async function dismissNewsletterPrompt(): Promise<{ success: boolean; error?: unknown }> {
  try {
    const currentAuth = auth;
    const database = db;
    if (!browser) return { success: false, error: 'Not in browser environment' };
    if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated' };

    const { doc, getDoc } = await import('firebase/firestore');
    const settingsRef = doc(database, 'userSettings', currentAuth.currentUser.uid);
    const existing = await getDoc(settingsRef);
    const previous = existing.exists() ? (existing.data() as UserSettings) : null;
    if (previous?.newsletterPromptDismissedAt) {
      publishNewsletter(previous, true);
      return { success: true };
    }
    const next = { ...(previous ?? {}), newsletterPromptDismissedAt: new Date().toISOString() };
    return await writeOwnSettings(next);
  } catch (error) {
    console.error('Error dismissing newsletter prompt:', error);
    return { success: false, error };
  }
}