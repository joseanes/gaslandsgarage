import { db } from "$lib/firebase";
import type { Draft } from "$lib/validate/model";

async function firestore() {
  if (!db) throw new Error("Database not initialized");
  const api = await import("firebase/firestore");
  return { ...api, db };
}

const USERS_COLLECTION = "users";
const TEAMS_COLLECTION = "teams";

// Get user data
export async function getUserData(userId: string) {
  try {
    const { doc, getDoc, setDoc, db: database } = await firestore();
    const userDocRef = doc(database, USERS_COLLECTION, userId);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      return { success: true, data: userDoc.data() };
    } else {
      // Create user document if it doesn't exist
      await setDoc(userDocRef, {
        createdAt: new Date(),
        teams: []
      });
      return { success: true, data: { createdAt: new Date(), teams: [] } };
    }
  } catch (error) {
    console.error("Error getting user data:", error);
    return { success: false, error };
  }
}

// Save a team for a user
export async function saveTeam(userId: string, teamName: string, draft: Draft) {
  try {
    // Get a reference to the team document
    const { collection, doc, setDoc, db: database } = await firestore();
    const teamDocRef = doc(collection(database, USERS_COLLECTION, userId, TEAMS_COLLECTION));
    
    // Save the team
    await setDoc(teamDocRef, {
      teamName,
      draft,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    return { success: true, teamId: teamDocRef.id };
  } catch (error) {
    console.error("Error saving team:", error);
    return { success: false, error };
  }
}

// Get a user's teams
export async function getUserTeams(userId: string) {
  try {
    const { collection, getDocs, db: database } = await firestore();
    const teamsCollectionRef = collection(database, USERS_COLLECTION, userId, TEAMS_COLLECTION);
    const teamsSnapshot = await getDocs(teamsCollectionRef);
    
    if (!teamsSnapshot.empty) {
      const teams = teamsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      return { success: true, teams };
    } else {
      return { success: true, teams: [] };
    }
  } catch (error) {
    console.error("Error getting user teams:", error);
    return { success: false, error };
  }
}

// Delete a team
export async function deleteTeam(userId: string, teamId: string) {
  try {
    const { doc, deleteDoc, db: database } = await firestore();
    const teamDocRef = doc(database, USERS_COLLECTION, userId, TEAMS_COLLECTION, teamId);
    await deleteDoc(teamDocRef);
    return { success: true };
  } catch (error) {
    console.error("Error deleting team:", error);
    return { success: false, error };
  }
}