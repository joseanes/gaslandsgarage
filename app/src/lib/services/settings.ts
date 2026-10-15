import { auth, db } from '../firebase';
import { browser } from '$app/environment';

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

/**
 * Save user settings to Firestore
 */
export async function saveUserSettings(settings: UserSettings): Promise<{ success: boolean; error?: any }> {
  try {
    const currentAuth = auth;
    const database = db;
    if (!browser) return { success: false, error: 'Not in browser environment' };
    if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated' };

    const { doc, setDoc } = await import('firebase/firestore');
    const userId = currentAuth.currentUser.uid;
    await setDoc(doc(database, 'userSettings', userId), settings);
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
    if (!currentAuth?.currentUser || !database) return { success: false, error: 'User not authenticated', settings: DEFAULT_SETTINGS };

    const { doc, getDoc } = await import('firebase/firestore');
    const userId = currentAuth.currentUser.uid;
    console.log("Getting settings for user:", userId);
    const settingsSnapshot = await getDoc(doc(database, 'userSettings', userId));
    
    if (settingsSnapshot.exists()) {
      const data = settingsSnapshot.data() as UserSettings;
      console.log("Retrieved user settings from Firebase:", data, "printStyle:", data.printStyle);
      
      // Ensure printStyle is preserved (defensive coding)
      if (!data.printStyle && DEFAULT_SETTINGS.printStyle) {
        console.log("No printStyle in Firebase data, using default:", DEFAULT_SETTINGS.printStyle);
        data.printStyle = DEFAULT_SETTINGS.printStyle;
      }
      
      return { success: true, settings: data };
    } else {
      // Create default settings if none exist
      console.log("No settings found for user, creating defaults");
      await saveUserSettings(DEFAULT_SETTINGS);
      return { success: true, settings: DEFAULT_SETTINGS };
    }
  } catch (error) {
    console.error('Error getting user settings:', error);
    return { success: false, error, settings: DEFAULT_SETTINGS };
  }
}