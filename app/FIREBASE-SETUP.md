# Firebase Setup for Gaslands Garage

The application uses Firebase for authentication and team storage. To make the "Save Team" functionality work, you need to set up the correct security rules in your Firebase project.

Deploy `app/firestore.rules` (see [docs/ADMIN.md](../docs/ADMIN.md)). The sample later in this file is an older subset from before administrator roles and account disabling. Pasting it over the live rules removes those checks.

## Setting Up Firebase Security Rules

The "Missing or insufficient permissions" error occurs because Firebase Firestore security rules are restricting write access to the database. Follow these steps to fix it:

### Option 1: Using the Firebase Console (Easiest)

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Select the project "gaslandsgarage-74ce6"
3. Click on "Firestore Database" in the left sidebar
4. Click on the "Rules" tab
5. Replace the current rules with the following:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default deny all access
    match /{document=**} {
      allow read, write: if false;
    }
    
    // Teams collection rules
    match /teams/{teamId} {
      // Allow read if user is authenticated and is the owner of the team
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      
      // Allow create if user is authenticated and sets themselves as the owner
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      
      // Allow update if user is authenticated and is the owner of the team
      // and doesn't change the userId field
      allow update: if request.auth != null 
                    && resource.data.userId == request.auth.uid
                    && request.resource.data.userId == resource.data.userId;
      
      // Allow delete if user is authenticated and is the owner of the team
      allow delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
  }
}
```

6. Click "Publish" to deploy the rules

### Option 2: Using the Firebase CLI

1. Install the Firebase CLI globally:
   ```
   npm install -g firebase-tools
   ```

2. Log in to Firebase:
   ```
   firebase login
   ```

3. Initialize Firebase in your project (if not already done):
   ```
   firebase init firestore
   ```

4. Deploy the rules from the included firestore.rules file:
   ```
   firebase deploy --only firestore:rules
   ```

### Option 3: Using the included script

1. Make sure you have Node.js installed
2. Install the Firebase CLI globally:
   ```
   npm install -g firebase-tools
   ```

3. Log in to Firebase:
   ```
   firebase login
   ```

4. Run the deployment script:
   ```
   node deploy-firebase-rules.js
   ```

## Testing the Rules

After deploying the rules, try to save a team again. If you've set up the rules correctly, you should no longer see the "Missing or insufficient permissions" error.

## Rule Explanation

These security rules ensure:

1. Only authenticated users can read, create, update, or delete teams
2. Users can only access teams they created (based on the userId field)
3. When creating a team, the userId must match the user's authentication ID
4. When updating a team, the user can't change the owner (userId)

This is a basic security model that ensures users can only access their own data.