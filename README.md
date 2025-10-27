# FluidPowerTools Time Tracker

A fully client-side project time tracker designed for FluidPowerTools. The app stores data in `localStorage`, allowing offline use while providing quick export/import utilities for backups.

## Running locally
Open `index.html` in any modern browser. All data stays on the device and is never uploaded.

## Deploying to GitHub Pages
1. Commit the project to a GitHub repository.
2. Push the repository to GitHub.
3. In the repository settings, enable **GitHub Pages** and choose the branch that contains this code (usually `main`) with the root folder (`/`).
4. After Pages finishes building, your tracker will be available at the published URL.

Because all paths are relative and assets live in the `assets/` folder, no additional build step is required for deployment.

## Project structure
```
.
├── assets
│   ├── css
│   │   └── styles.css
│   └── js
│       └── app.js
├── index.html
└── README.md
```
