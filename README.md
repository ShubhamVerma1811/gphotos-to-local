# Google Photos Fetcher

## Description

Google Photos Fetcher is a TypeScript application that allows users to authenticate with the Google Photos API and download media items from their Google Photos library. The application fetches images and stores them in a local directory.

## Features

- OAuth2 authentication with Google APIs.
- Fetches media items from Google Photos.
- Downloads images and saves them in a specified local directory.
- Handles pagination for fetching media items.

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/ShubhamVerma1811/gphotos-to-local.git
   cd gphotos-to-local
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:
   ```properties
   CLIENT_ID=<your-client-id>
   CLIENT_SECRET=<your-client-secret>
   REFRESH_TOKEN=<your-refresh-token> # Optional, if you want to refresh tokens
   CODE=<authorization-code> # Use this for the first time only
   ```

## Usage

Run the application to authenticate and fetch media items from Google Photos:

```bash
pnpm dev
```

Follow the instructions in the console to authorize the application and obtain the access token.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
