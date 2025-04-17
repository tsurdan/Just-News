# Just News

**Just News** is a Chrome extension that automatically replaces misleading or clickbait news headlines with clear, factual, and objective alternatives. It enhances your browsing experience by letting you know the essence of an article—without needing to click.

---

## 🧠 How It Works

- Scans the page for visible news headlines.
- Extracts the full article content for each headline.
- Uses **Gemma AI via Groq API** to generate a new, informative title.
- Replaces the original headline directly on the page, in real time.

---

## 🔑 Setup Instructions

1. Download the extention from [chrome web store](https://chromewebstore.google.com/detail/just-news/bjeicinigicmeicfnibabdfanajpigln)
2. Enter to your favorite news website
3. Click on the Just-News extention icon
4. Follow the guide in the extension popup to generate and add your **Groq API key**.
5. Done. No more clickbait headlines.

---

## 📋 Features

- Clean, informative, non-clickbait headlines
- Multi-language support
- Lightweight and fast

---

## 🔐 Privacy Policy

Just News is designed with privacy in mind:

- No tracking
- No ads
- No personal data collection
- Article content is sent only to Groq's API for headline rewriting
- Your API key is stored **only in your browser's local storage**

For more details check the `privacy policy.md` file

---

## 💻 Dev Setup Instructions

1. Clone this repository.
2. Load it as an unpacked extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable **Developer mode**
   - Click **"Load unpacked"** and select the project folder
3. Follow the guide in the extension popup to generate and add your **Groq API key**.

---
## 🤝 Contributing

Want to improve or extend the extension? Contributions are welcome!
You can find bugs or feature suggestions in the repo issues

1. Fork this repository
2. Create a new branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to your fork: `git push origin feature/my-feature`
5. Open a Pull Request

Please open issues for bugs or feature suggestions. Let's make the news readable again—together!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).