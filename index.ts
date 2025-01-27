import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

export interface MediaResponse {
	mediaItems: MediaItem[];
	nextPageToken: string;
}

export interface MediaItem {
	id: string;
	productUrl: string;
	baseUrl: string;
	mimeType: string;
	mediaMetadata: MediaMetadata;
	filename: string;
	album?: string;
}

export interface MediaMetadata {
	creationTime: string;
	width: string;
	height: string;
	photo?: Photo;
	video?: Video;
}

export interface Photo {
	cameraMake?: string;
	cameraModel?: string;
	focalLength?: number;
	apertureFNumber?: number;
	isoEquivalent?: number;
	exposureTime?: string;
}

export interface Video {
	fps: number;
	status: string;
}

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const MEDIA_DIR = "media";

const oauth2Client = new google.auth.OAuth2(
	CLIENT_ID,
	CLIENT_SECRET,
	REDIRECT_URI,
);

async function getAccessToken() {
	console.group("%cGetting access token", "font-weight: bold");
	try {
		const authUrl = oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: ["https://www.googleapis.com/auth/photoslibrary.readonly"],
		});

		console.log("Authorize this app by visiting this url:", authUrl);
		const code = process.env.CODE;

		if (!code) {
			throw new Error("Code not found");
		}

		const { tokens } = await oauth2Client.getToken(code);
		oauth2Client.setCredentials(tokens);

		console.log("Access Token:", tokens.access_token);
		console.log("Refresh Token:", tokens.refresh_token);
	} catch (error) {
		console.error("Error getting access token:", error);
	} finally {
		console.groupEnd();
	}
}

async function refreshAccessToken() {
	console.group("%cRefreshing access token", "font-weight: bold");
	try {
		const { credentials } = oauth2Client;
		if (credentials.refresh_token || REFRESH_TOKEN) {
			oauth2Client.setCredentials({
				refresh_token: credentials.refresh_token || REFRESH_TOKEN,
			});
			await oauth2Client.getAccessToken();
			console.log("New Access Token:", oauth2Client.credentials.access_token);
		} else {
			console.error("No refresh token available.");
		}
	} catch (error) {
		console.error("Error refreshing access token:", error);
	} finally {
		console.groupEnd();
	}
}

async function fetchMediaItems(): Promise<MediaItem[]> {
	console.group("%cFetching Google Photos", "font-weight: bold");
	const obj = [];
	try {
		let nextPageToken: string | null = null;
		const mediaItems: MediaItem[] = [];

		do {
			console.log("Requesting media items...");
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
			obj.push(data);
			console.log(`Received ${data.mediaItems.length} media items.`);
			mediaItems.push(...data.mediaItems);
			nextPageToken = data.nextPageToken ?? null;

			console.log(`Total fetched items so far: ${mediaItems.length}`);
		} while (nextPageToken);

		console.log(`Fetched a total of ${mediaItems.length} images.`);
		fs.writeFileSync("./mediaItems.json", JSON.stringify(mediaItems, null, 2));
		return mediaItems;
	} catch (error) {
		console.error("Error fetching Google Photos:", error);
		return [];
	} finally {
		console.groupEnd();
	}
}

async function fetchMediaFromId(mediaItems: MediaItem[]) {
	if (!fs.existsSync(MEDIA_DIR)) {
		fs.mkdirSync(MEDIA_DIR, { recursive: true });
		console.log(`Created directory: ${MEDIA_DIR}`);
	}

	for (const item of mediaItems) {
		const imageName = path.basename(item.filename);
		if (fs.existsSync(path.join(MEDIA_DIR, imageName))) {
			console.log(`Skipping existing image: ${imageName}`);
			continue;
		}

		const imageUrl = `${item.baseUrl}`;
		console.log(`Downloading image: ${item.filename}`);
		try {
			const imageResponse = await fetch(imageUrl);
			if (!imageResponse.ok) {
				throw new Error(`HTTP error! status: ${imageResponse.status}`);
			}
			const imagePath: string = path.join(MEDIA_DIR, imageName);

			const buffer = await imageResponse.arrayBuffer();
			fs.writeFileSync(imagePath, Buffer.from(buffer));
			console.log(
				`Saved image: ${imageName}${typeof item.album === "string" && item.album.trim() !== "" ? ` in album: ${item.album}` : ""}`,
			);
		} catch (error) {
			console.error("Error downloading image:", error);
		}
	}
}

async function main() {
	if (REFRESH_TOKEN) {
		await refreshAccessToken();
	} else {
		await getAccessToken();
	}
	const mediaItems = await fetchMediaItems();
	await fetchMediaFromId(mediaItems);
}

main();
