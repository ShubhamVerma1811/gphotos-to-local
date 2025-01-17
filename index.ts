import fs from "fs";
import { google } from "googleapis";
import path from "path";

interface MediaItem {
	id: string;
	filename: string;
	baseUrl: string;
	mediaMetadata: {
		photo: {
			creationTime: string;
		};
	};
	// Add other fields as necessary based on the API response
}

interface PhotosResponse {
	mediaItems: MediaItem[];
	nextPageToken?: string;
}

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback"; // Update for your redirect URI
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(
	CLIENT_ID,
	CLIENT_SECRET,
	REDIRECT_URI,
);

// Function to get the access token
const getAccessToken = async () => {
	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: ["https://www.googleapis.com/auth/photoslibrary.readonly"],
	});

	console.log("Authorize this app by visiting this url:", authUrl);
	const code = process.env.CODE!; // Use the code here for the first time only

	const { tokens } = await oauth2Client.getToken(code);
	oauth2Client.setCredentials(tokens);

	// Store the refresh token in your .env or a secure location
	console.log("Access Token:", tokens.access_token);
	console.log("Refresh Token:", tokens.refresh_token); // Store this securely
};

// Function to refresh the access token
const refreshAccessToken = async () => {
	const { credentials } = oauth2Client;
	if (credentials.refresh_token || REFRESH_TOKEN) {
		oauth2Client.setCredentials({
			refresh_token: credentials.refresh_token || REFRESH_TOKEN,
		});
		await oauth2Client.getAccessToken(); // This will refresh the access token
		console.log("New Access Token:", oauth2Client.credentials.access_token);
	} else {
		console.error("No refresh token available.");
	}
};

// Fetch Google Photos media
const fetchGooglePhotos = async () => {
	try {
		console.log(`Fetching media items...`);
		let nextPageToken: string | null = null;
		const mediaItems: MediaItem[] = [];
		const fetchedImageIds = new Set<string>(); // Set to track fetched image IDs

		do {
			console.log(`Requesting media items...`);
			const url = new URL("https://photoslibrary.googleapis.com/v1/mediaItems");
			url.searchParams.set("pageSize", "50");
			if (nextPageToken) {
				url.searchParams.set("pageToken", nextPageToken);
			}

			const response = await fetch(url.toString(), {
				method: "GET",
				headers: {
					Authorization: `Bearer ${oauth2Client.credentials.access_token}`,
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			console.log(`Received ${data.mediaItems.length} media items.`);
			mediaItems.push(...data.mediaItems);
			nextPageToken = data.nextPageToken ?? null;

			// Log total fetched items
			console.log(`Total fetched items so far: ${mediaItems.length}`);
		} while (nextPageToken); // Keep fetching as long as there's a nextPageToken

		console.log(`Fetched a total of ${mediaItems.length} images.`);

		// Store all images directly in the media folder
		const dir = "./media"; // Changed directory name to media
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			console.log(`Created directory: ${dir}`);
		}

		for (const item of mediaItems) {
			const imageId = item.id;
			if (fetchedImageIds.has(imageId)) {
				console.log(`Skipping already fetched image: ${item.filename}`);
				continue; // Skip if already fetched
			}
			fetchedImageIds.add(imageId); // Add to the set of fetched IDs

			const imageUrl = item.baseUrl + "=w2048-h1024"; // Adjust size as needed
			console.log(`Downloading image: ${item.filename}`);
			const imageResponse = await fetch(imageUrl);
			if (!imageResponse.ok) {
				throw new Error(`HTTP error! status: ${imageResponse.status}`);
			}
			const imageName = path.basename(item.filename); // Use the filename from the response
			if (fs.existsSync(path.join(dir, imageName))) {
				console.log(`Skipping existing image: ${imageName}`);
			} else {
				const buffer = await imageResponse.arrayBuffer();
				fs.writeFileSync(path.join(dir, imageName), Buffer.from(buffer));
				console.log(`Saved image: ${imageName}`);
			}
		}
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error("Error fetching Google Photos:", error.message);
		} else {
			console.error("Unexpected error:", error);
		}
	}
};

// Call the functions
(async () => {
	if (REFRESH_TOKEN) {
		await refreshAccessToken();
	} else {
		await getAccessToken();
	}
	await fetchGooglePhotos(); // Fetch all images
})();
