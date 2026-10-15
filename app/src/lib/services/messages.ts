import { db } from "$lib/firebase";
import { initializeFirebase } from "$lib/firebase";

const MESSAGES_COLLECTION = "messages";

// Save a message from a user
export async function sendContactMessage(userId: string, email: string, subject: string, message: string) {
  try {
    // Make sure Firebase is initialized
    const initResult = await initializeFirebase();
    if (!initResult.success) {
      console.error("Firebase initialization failed:", initResult.error);
      return { success: false, error: "Firebase initialization failed" };
    }
    
    console.log("Firebase initialized, preparing to save message");
    const database = db;
    if (!database) return { success: false, error: "Database not initialized" };
    const { collection, addDoc, serverTimestamp } = await import("firebase/firestore");
    
    // Validate inputs
    if (!userId) {
      return { success: false, error: "User ID is required" };
    }
    
    if (!subject || !message) {
      return { success: false, error: "Subject and message are required" };
    }
    
    // Create the message document
    const messageData = {
      userId,
      email: email || "No email provided",
      subject,
      message,
      createdAt: serverTimestamp(),
      read: false,
      recipient: "jose.anes@gmail.com" 
    };
    
    console.log("Saving message to Firestore:", { ...messageData, userId: "REDACTED" });
    
    // Get a reference to the messages collection
    const messagesCollectionRef = collection(database, MESSAGES_COLLECTION);
    
    // Save the message
    const docRef = await addDoc(messagesCollectionRef, messageData);
    console.log("Message saved with ID:", docRef.id);
    
    return { success: true, messageId: docRef.id };
  } catch (error) {
    console.error("Error sending message:", error);
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}