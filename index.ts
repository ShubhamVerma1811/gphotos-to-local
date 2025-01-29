import chalk from "chalk";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import ora, { type Ora } from "ora";

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

interface GooglePhotosResponse {
	mediaItems: MediaItem[];
	nextPageToken?: string;
}

interface MediaStats {
	downloaded: number;
	skipped: number;
	deleted: number;
	errors: number;
}

interface GooglePhotosSyncConfig {
	clientId: string;
	clientSecret: string;
	redirectUri?: string;
	refreshToken?: string;
	mediaDir?: string;
}

class GooglePhotosSync {
	private readonly oauth2Client;
	private readonly spinner: Ora;
	private readonly config: Required<GooglePhotosSyncConfig>;

	constructor(config: GooglePhotosSyncConfig) {
		this.config = {
			...config,
			redirectUri: config.redirectUri ?? "http://localhost:3000/oauth2callback",
			refreshToken: config.refreshToken ?? null,
		} as Required<GooglePhotosSyncConfig>;

		this.oauth2Client = new google.auth.OAuth2(
			this.config.clientId,
			this.config.clientSecret,
			this.config.redirectUri,
		);
		this.spinner = ora({
			color: "yellow",
		});
	}

	private async getAccessToken(): Promise<void> {
		try {
			const authUrl = this.oauth2Client.generateAuthUrl({
				access_type: "offline",
				scope: ["https://www.googleapis.com/auth/photoslibrary.readonly"],
			});

			console.log("Authorize this app by visiting this url:", authUrl);
			const code = process.env.CODE;

			if (!code) {
				throw new Error("Code not found");
			}

			const { tokens } = await this.oauth2Client.getToken(code);
			this.oauth2Client.setCredentials(tokens);
		} catch (error) {
			console.error("Error getting access token:", error);
			throw error;
		}
	}

	private async refreshAccessToken(): Promise<void> {
		console.log(chalk.bold("Refreshing access token"));
		try {
			const { credentials } = this.oauth2Client;
			if (credentials.refresh_token || this.config.refreshToken) {
				this.oauth2Client.setCredentials({
					refresh_token: credentials.refresh_token || this.config.refreshToken,
				});
				const response = await this.oauth2Client.getAccessToken();
				const token = response.token || response.res?.data?.access_token;
				if (!token) {
					throw new Error("Failed to get new access token");
				}
				this.oauth2Client.setCredentials({ access_token: token });
				console.log(chalk.green("New Access Token fetched"));
			} else {
				throw new Error("No refresh token available.");
			}
		} catch (error) {
			console.error(chalk.red("Error refreshing access token:"), error);
			throw error;
		}
	}

	private async fetchMediaItems(): Promise<MediaItem[]> {
		this.spinner.start(chalk.yellow("Fetching Google Photos..."));

		try {
			let nextPageToken: string | null = null;
			const mediaItems: MediaItem[] = [];

			do {
				try {
					this.spinner.text = chalk.yellow("Requesting media items...");
					const url = new URL(
						"https://photoslibrary.googleapis.com/v1/mediaItems",
					);
					url.searchParams.set("pageSize", "50");

					if (nextPageToken) {
						url.searchParams.set("pageToken", nextPageToken);
					}

					const credentials = await this.oauth2Client.getAccessToken();
					if (!credentials.token) {
						throw new Error("No access token available");
					}

					const response = await fetch(url.toString(), {
						method: "GET",
						headers: {
							Authorization: `Bearer ${credentials.token}`,
						},
					});

					if (!response.ok) {
						throw new Error(`HTTP error! status: ${response.status}`);
					}

					const data: GooglePhotosResponse = await response.json();
					if (data.mediaItems) {
						mediaItems.push(...data.mediaItems);
						console.log(
							chalk.green(` Received ${data.mediaItems.length} media items`),
						);
					}
					nextPageToken = data.nextPageToken ?? null;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(`Error fetching media items: ${errorMessage}`),
					);
				}
			} while (nextPageToken);

			this.spinner.succeed(chalk.green("Successfully fetched all media items"));
			return mediaItems;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.spinner.fail(
				chalk.red(`Failed to fetch media items: ${errorMessage}`),
			);
			return [];
		}
	}

	private async downloadMedia(mediaItems: MediaItem[]): Promise<MediaStats> {
		const stats: MediaStats = {
			downloaded: 0,
			skipped: 0,
			deleted: 0,
			errors: 0,
		};

		if (!fs.existsSync(this.config.mediaDir)) {
			fs.mkdirSync(this.config.mediaDir, { recursive: true });
		}

		// Get all files from local directory
		const localFiles = new Set(fs.readdirSync(this.config.mediaDir));

		// Create a set of filenames from Google Photos response
		const googlePhotosFiles = new Set(
			mediaItems.map((item) => path.basename(item.filename)),
		);

		// Find files that exist locally but not in Google Photos
		for (const localFile of localFiles) {
			if (!googlePhotosFiles.has(localFile)) {
				const localPath = path.join(this.config.mediaDir, localFile);
				try {
					fs.unlinkSync(localPath);
					console.log(
						chalk.red(
							` Deleted local file: ${localFile} (removed from Google Photos)`,
						),
					);
					stats.deleted++;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(` Error deleting file ${localFile}: ${errorMessage}`),
					);
					stats.errors++;
				}
			}
		}

		// Download new files
		for (const item of mediaItems) {
			const imageName = path.basename(item.filename);
			if (fs.existsSync(path.join(this.config.mediaDir, imageName))) {
				console.log(chalk.yellow(` Skipping existing image: ${imageName}`));
				stats.skipped++;
				continue;
			}

			const imageUrl = `${item.baseUrl}=d`;
			const imagePath = path.join(this.config.mediaDir, imageName);
			console.log(chalk.yellow(` Downloading image: ${item.filename}`));
			try {
				const imageResponse = await fetch(imageUrl);
				if (!imageResponse.ok) {
					throw new Error(`HTTP error! status: ${imageResponse.status}`);
				}
				const buffer = await imageResponse.arrayBuffer();
				fs.writeFileSync(imagePath, Buffer.from(buffer));
				console.log(chalk.green(` Saved image: ${imageName}`));
				stats.downloaded++;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(` Error downloading image: ${errorMessage}`));
				stats.errors++;
			}
		}

		return stats;
	}

	private displaySummary(stats: MediaStats): void {
		console.log(`\n${chalk.bold.blue("=== Sync Summary ===")}`);
		console.log(chalk.green(`✓ Downloaded: ${stats.downloaded} files`));
		console.log(chalk.yellow(`⚠ Skipped: ${stats.skipped} files`));
		console.log(chalk.red(`✗ Deleted: ${stats.deleted} files`));
		if (stats.errors > 0) {
			console.log(chalk.red(`⚠ Errors encountered: ${stats.errors}`));
		}
		console.log(chalk.bold.blue("------------------\n"));
	}

	public async sync(): Promise<void> {
		if (this.config.refreshToken) {
			await this.refreshAccessToken();
		} else {
			await this.getAccessToken();
		}
		const mediaItems = await this.fetchMediaItems();
		const stats = await this.downloadMedia(mediaItems);
		this.displaySummary(stats);
	}
}

// Initialize and run the sync
const sync = new GooglePhotosSync({
	clientId: process.env.CLIENT_ID!,
	clientSecret: process.env.CLIENT_SECRET!,
	refreshToken: process.env.REFRESH_TOKEN,
	mediaDir: "media",
});

sync.sync();
