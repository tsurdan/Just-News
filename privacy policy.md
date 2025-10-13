# Extension Privacy Policy

## Data Collection
Just News Chrome Extension does not collect any personal data from users. Since no personal data is collected, none of your data can be sold to third parties.

## Freemium Model
The extension operates on a freemium model with both free and premium tiers. Usage data such as daily API call counts are tracked locally in your browser to enforce daily limits for free users. This data is not transmitted to external servers and remains on your device only.

## Chrome Storage API
The extension uses Google Chrome's Storage API to locally store:
- Your API key (for accessing the selected LLM API, defaultly Groq API)
- Premium subscription status (for users who have upgraded)
- Daily usage counters (for free tier usage limits)
- User preferences and settings

All this data is stored locally on your device and is used only for extension functionality. This local storage is similar to a cookie and is not accessible to other websites or transmitted to external servers.

## Third-Party API
As mentioned, the extension interacts with a third-party API to generate informative headlines. The default LLM api is groq api, that hosting meta llama model, but if selected it can make the requests to gemini, chatgpt or claude. When you click on the extension, it identifies headlines on a news website, extracts the content of the articles, and sends this content to the slected LLM API to generate new headlines. The data sent to the API includes:
- The original headline
- The content of the article

No personal information is sent to the API. However, the request headers may include your IP address and user agent string, which are standard for HTTP requests, and this is not something that extensions have control over. If this is a concern, consider using a VPN to mask your IP address.

## Premium Features and Payment
For premium subscribers, the extension removes daily usage limits and unlocks additional features. Payment processing is handled by external payment providers, and the extension does not store or process payment information directly.

## Permissions
The extension requests the following permissions:
- `activeTab`: To interact with the currently active tab and access its content.
- `scripting`: To inject scripts into web pages.
- `storage`: To store the API key, premium status, usage counters, and settings locally.
- `webNavigation`: To detect when premium subscription unlocked for premium activation.

These permissions are necessary for the extension to function correctly and provide the intended features.

## Changes to the Privacy Policy
If there are substantive changes made to this privacy policy, a new version of the extension will be released, and you will be asked to agree to the amended privacy policy.

## Feedback
If you have questions or concerns about this privacy policy, feel free to create an issue in the repository.