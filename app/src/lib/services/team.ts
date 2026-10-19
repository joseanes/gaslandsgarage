import { auth, db, user } from '../firebase';
import { detachTeamPhotos } from './vehiclePhotos';
export type TeamSavePayload = {
  teamName?: string;
  sponsor?: string;
  sponsorId?: string;
  vehicles?: unknown;
  maxCans?: number;
  darkMode?: boolean;
  [key: string]: unknown;
};
import { browser } from '$app/environment';

// Import Firestore types without importing the actual implementation
type FirestoreDocument = {
  id: string;
  [key: string]: any;
};

// Collection names
const TEAMS_COLLECTION = 'teams';

interface SaveTeamResult {
  success: boolean;
  teamId?: string;
  error?: any;
}

interface GetTeamsResult {
  success: boolean;
  teams?: any[];
  error?: any;
}

interface DeleteTeamResult {
  success: boolean;
  error?: any;
}

/**
 * Save a team to the user's account
 * If existingTeamId is provided, it will overwrite that team instead of creating a new one
 */
export async function saveTeam(teamData: TeamSavePayload, teamName: string, existingTeamId?: string): Promise<SaveTeamResult> {
  if (!browser) return { success: false, error: "Cannot run on server" };
  if (!auth?.currentUser) return { success: false, error: "User not authenticated" };
  
  try {
    console.log("Attempting to save team...");
    const userId = auth.currentUser.uid;
    
    // Create a timestamp for tracking creation/update time
    const timestamp = new Date().toISOString();
    
    // Make sure the teamData is safe for Firebase by removing any circular references
    // and converting any complex objects to simpler formats
    const safeTeamData = JSON.parse(JSON.stringify(teamData));
    
    // Create the team document. Buddies can read a team only when this is false.
    const teamDoc: {
      userId: string;
      teamName: string;
      teamData: typeof safeTeamData;
      createdAt: string;
      updatedAt: string;
      hiddenFromBuddies: boolean;
    } = {
      userId,
      teamName,
      teamData: safeTeamData,
      createdAt: timestamp,
      updatedAt: timestamp,
      hiddenFromBuddies: false
    };
    
    // Dynamically import Firestore functions
    const { collection, addDoc, setDoc, doc, query, where, getDocs, getDoc } = await import('firebase/firestore');
    
    // Make sure Firebase is properly initialized before proceeding
    const database = db;
    if (!database) {
      console.error("Firestore db not initialized");
      return { success: false, error: "Database not initialized" };
    }
    
    console.log("Firebase initialized, attempting to save document...");
    
    // Check for existing team with same name (if we're not updating an existing team)
    if (!existingTeamId) {
      try {
        console.log("Checking for existing teams with name:", teamName);
        const teamsCollectionRef = collection(database, TEAMS_COLLECTION);
        const q = query(
          teamsCollectionRef, 
          where("userId", "==", userId),
          where("teamName", "==", teamName)
        );
        const existingTeamsSnapshot = await getDocs(q);
        
        if (!existingTeamsSnapshot.empty) {
          console.log(`Found ${existingTeamsSnapshot.size} existing teams with name "${teamName}"`);
          
          // Get the first existing team and use its ID for the update
          const existingTeam = existingTeamsSnapshot.docs[0];
          existingTeamId = existingTeam.id;
          console.log("Will update existing team with ID:", existingTeamId);
          
          // If there are additional teams with the same name, log a warning
          if (existingTeamsSnapshot.size > 1) {
            console.warn(`Multiple teams (${existingTeamsSnapshot.size}) with name "${teamName}" found. Using first one.`);
          }
        }
      } catch (e) {
        console.error("Error checking for existing teams:", e);
        // Continue with regular save if this fails
      }
    }
    
    // If we have an existing team ID, update it instead of creating a new one
    if (existingTeamId) {
      console.log("Updating existing team with ID:", existingTeamId);
      const teamDocRef = doc(database, TEAMS_COLLECTION, existingTeamId);
      
      // For updates, we keep the original createdAt time
      try {
        const existingTeamDoc = await getDoc(doc(database, TEAMS_COLLECTION, existingTeamId));
        if (existingTeamDoc.exists() && existingTeamDoc.data().createdAt) {
          teamDoc.createdAt = existingTeamDoc.data().createdAt;
        }
        if (existingTeamDoc.exists() && existingTeamDoc.data().hiddenFromBuddies === true) {
          teamDoc.hiddenFromBuddies = true;
        }
      } catch (e) {
        console.warn("Could not get original createdAt time, using current time instead:", e);
      }
      
      // Update the existing document
      await setDoc(teamDocRef, teamDoc);
      console.log("Team updated successfully with ID:", existingTeamId);
      return { success: true, teamId: existingTeamId };
    } else {
      // Create a new team document
      // Try to ensure we have a valid collection reference
      let teamsCollectionRef;
      try {
        teamsCollectionRef = collection(database, TEAMS_COLLECTION);
      } catch (e) {
        console.error("Failed to get collection reference:", e);
        return { success: false, error: "Failed to access teams collection" };
      }
      
      // Add the document to the teams collection
      const docRef = await addDoc(teamsCollectionRef, teamDoc);
      console.log("Team saved successfully with ID:", docRef.id);
      
      return { success: true, teamId: docRef.id };
    }
  } catch (error) {
    console.error("Error saving team:", error);
    console.error("Error details:", error instanceof Error ? error.message : JSON.stringify(error));
    
    // Try to provide a more helpful error message
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check for common Firebase errors
      if (errorMessage.includes("permission-denied")) {
        errorMessage = "Permission denied. You may not have access to save teams.";
      } else if (errorMessage.includes("network")) {
        errorMessage = "Network error. Please check your connection.";
      } else if (errorMessage.includes("quota")) {
        errorMessage = "Database quota exceeded. Please try again later.";
      }
    }
    
    return { success: false, error: errorMessage };
  }
}

/**
 * Vehicles stored on one of the signed-in player's teams.
 * Null means the saved team could not be read.
 */
export async function getSavedTeamVehicles(teamId: string): Promise<unknown[] | null> {
  if (!browser || !teamId) return null;
  const currentAuth = auth;
  const database = db;
  if (!currentAuth?.currentUser || !database) return null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(database, TEAMS_COLLECTION, teamId));
    if (!snap.exists() || snap.data().userId !== currentAuth.currentUser.uid) return null;
    const teamData = snap.data().teamData;
    if (!teamData || typeof teamData !== 'object') return [];
    const vehicles = (teamData as { vehicles?: unknown }).vehicles;
    return Array.isArray(vehicles) ? vehicles : [];
  } catch (error) {
    console.error('Could not read the saved team:', error);
    return null;
  }
}

/**
 * Get all teams for the current user
 */
export async function getUserTeams(): Promise<GetTeamsResult> {
  if (!browser) return { success: false, error: "Cannot run on server" };
  const currentAuth = auth;
  const database = db;
  if (!currentAuth?.currentUser || !database) return { success: false, error: "User not authenticated" };
  
  try {
    const userId = currentAuth.currentUser.uid;
    
    // Dynamically import Firestore functions
    const { collection, query, where, getDocs, updateDoc } = await import('firebase/firestore');
    
    // Query the teams collection for documents with the user's ID
    const teamsCollectionRef = collection(database, TEAMS_COLLECTION);
    const q = query(teamsCollectionRef, where("userId", "==", userId));
    const teamsSnapshot = await getDocs(q);
    
    if (!teamsSnapshot.empty) {
      const teams = [];
      for (const teamDoc of teamsSnapshot.docs) {
        const data = teamDoc.data() as { updatedAt?: string; hiddenFromBuddies?: boolean };
        console.log("Team data from Firestore:", data);
        if (data.hiddenFromBuddies !== true && data.hiddenFromBuddies !== false) {
          try {
            await updateDoc(teamDoc.ref, { hiddenFromBuddies: false });
            data.hiddenFromBuddies = false;
          } catch (backfillError) {
            console.warn("Could not mark team visibility for buddies:", backfillError);
          }
        }
        teams.push({
          id: teamDoc.id,
          ...data
        });
      }
      
      // Sort by updated time, newest first
      teams.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
      
      return { success: true, teams };
    } else {
      return { success: true, teams: [] };
    }
  } catch (error) {
    console.error("Error getting user teams:", error);
    return { success: false, error };
  }
}

/**
 * Delete a team
 */
export async function deleteTeam(teamId: string): Promise<DeleteTeamResult> {
  if (!browser) return { success: false, error: "Cannot run on server" };
  const currentAuth = auth;
  const database = db;
  if (!currentAuth?.currentUser || !database) return { success: false, error: "User not authenticated" };
  
  try {
    const userId = currentAuth.currentUser.uid;
    
    // Dynamically import Firestore functions
    const { doc, getDoc, deleteDoc } = await import('firebase/firestore');
    
    // First verify this team belongs to the user
    const teamDocRef = doc(database, TEAMS_COLLECTION, teamId);
    const teamDoc = await getDoc(teamDocRef);
    
    if (!teamDoc.exists()) {
      return { success: false, error: "Team not found" };
    }
    
    const teamData = teamDoc.data();
    if (teamData.userId !== userId) {
      return { success: false, error: "Unauthorized access to team" };
    }
    
    // Detach photos first, so a failed detach leaves the team to retry. The files stay in My Photos.
    await detachTeamPhotos(teamId);

    // Delete the team document
    await deleteDoc(teamDocRef);
    
    return { success: true };
  } catch (error) {
    console.error("Error deleting team:", error);
    return { success: false, error };
  }
}

/**
 * Hide or show one of the signed-in player's teams. Buddies cannot change this.
 */
export async function setTeamHiddenFromBuddies(teamId: string, hidden: boolean): Promise<DeleteTeamResult> {
  if (!browser) return { success: false, error: "Cannot run on server" };
  const currentAuth = auth;
  const database = db;
  if (!currentAuth?.currentUser || !database) return { success: false, error: "User not authenticated" };

  try {
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');
    const teamDocRef = doc(database, TEAMS_COLLECTION, teamId);
    const teamDoc = await getDoc(teamDocRef);
    if (!teamDoc.exists()) return { success: false, error: "Team not found" };
    if (teamDoc.data().userId !== currentAuth.currentUser.uid) {
      return { success: false, error: "Unauthorized access to team" };
    }
    await updateDoc(teamDocRef, { hiddenFromBuddies: hidden });
    return { success: true };
  } catch (error) {
    console.error("Error updating buddy visibility:", error);
    return { success: false, error };
  }
}