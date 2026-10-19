// Public Firebase web configs. These identify projects; access is enforced by
// Firestore/Storage rules and Auth authorized domains, not by secrecy.
export type FirebaseEnvironment = "production" | "staging";

export interface FirebaseWebConfig {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
	measurementId?: string;
}

export const FIREBASE_CONFIGS: Record<FirebaseEnvironment, FirebaseWebConfig> = {
	production: {
		apiKey: "AIzaSyAW7eGDsJwWtaj3I1lrcuzvFx8vkX5EaKI",
		authDomain: "gaslandsgarage-74ce6.firebaseapp.com",
		projectId: "gaslandsgarage-74ce6",
		storageBucket: "gaslandsgarage-74ce6.firebasestorage.app",
		messagingSenderId: "636098164916",
		appId: "1:636098164916:web:b3586c38da2ebaf9c13fe1",
		measurementId: "G-EKPMXMY097"
	},
	staging: {
		apiKey: "AIzaSyAHDHiAjxbvqyIk7oFCK7TfKEv6bsDUAsg",
		authDomain: "gaslandsgarage-staging.firebaseapp.com",
		projectId: "gaslandsgarage-staging",
		storageBucket: "gaslandsgarage-staging.firebasestorage.app",
		messagingSenderId: "1059520931399",
		appId: "1:1059520931399:web:de715e0e4e4be137d47362"
	}
};

/** Builds default to production; only an explicit VITE_GG_ENV=staging selects staging. */
export function firebaseEnvironment(value: unknown): FirebaseEnvironment {
	return value === "staging" ? "staging" : "production";
}

export function firebaseConfigFor(value: unknown): FirebaseWebConfig {
	return FIREBASE_CONFIGS[firebaseEnvironment(value)];
}

export function cloudFunctionUrl(name: string, value: unknown): string {
	return `https://us-central1-${firebaseConfigFor(value).projectId}.cloudfunctions.net/${name}`;
}
