
# Onetel Hotspot Captive Portal

Professional registration and login gateway for the **Onetel Network**.

## 🚀 Live URL
Your portal is hosted at:
`https://tmanscript.github.io/captive-portal/`

## 🛠️ Deployment Fix (Crucial)
If you see the error `Deployments are only allowed from gh-pages` in your GitHub Actions, follow these steps:
1. Go to your GitHub Repository -> **Settings**.
2. Click **Pages** on the left menu.
3. Under **Build and deployment** -> **Source**, select **GitHub Actions**.
4. Re-run your failed workflow.

## ⚙️ OpenWISP Setup Instructions

Copy and paste these exact values into your OpenWISP Hotspot configuration:

### 1. URLs
Paste `https://tmanscript.github.io/captive-portal/` into these fields:
- **uamhomepage**
- **uamserver**
- **chilli_login_page**

### 2. Walled Garden (uamallowed)
Paste the following list into the **uamallowed** field to ensure the app loads before login:
`tmanscript.github.io,esm.sh,cdn.tailwindcss.com,fonts.googleapis.com,fonts.gstatic.com,api.allorigins.win,corsproxy.io,api.codetabs.com,device.onetel.co.za`

## ✨ Features
- **OTP Verification**: Secure registration via mobile phone.
- **Usage Tracking**: Real-time data balance monitoring.
- **Responsive Design**: Optimized for all mobile devices.
- **OpenWISP Native**: Auto-detects `uamip` and `uamport` from redirect parameters.
