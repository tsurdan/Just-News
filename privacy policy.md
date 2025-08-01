# Extension Privacy Policy

## Data Collection
Just News Chrome Extension does not collect any personal data. Since no personal data is collected, none of your data can be sold to third parties.

## Chrome Storage API
The extension uses Google Chrome's Storage API to locally store your API key (for accessing the selected LLM API (defaultly groq api)). This key is stored locally on your device and is used to authenticate requests to the LLM API when you click on the extension. This local storage is similar to a cookie.

## Third-Party API
As mentioned, the extension interacts with a third-party API to generate informative headlines. The default LLM api is groq api, that hosting google gemma model, but if selected it can make the requests to gemini, chatgpt or claude. When you click on the extension, it identifies headlines on a news website, extracts the content of the articles, and sends this content to the slected LLM API to generate new headlines. The data sent to the API includes:
- The original headline
- The content of the article

No personal information is sent to the API. However, the request headers may include your IP address and user agent string, which are standard for HTTP requests, and this is not something that extensions have control over. If this is a concern, consider using a VPN to mask your IP address.

## Permissions
The extension requests the following permissions:
- `activeTab`: To interact with the currently active tab and access its content.
- `scripting`: To inject scripts into web pages.
- `storage`: To store the API key locally.

These permissions are necessary for the extension to function correctly and provide the intended features.

## Changes to the Privacy Policy
If there are substantive changes made to this privacy policy, a new version of the extension will be released, and you will be asked to agree to the amended privacy policy.

## Feedback
If you have questions or concerns about this privacy policy, feel free to create an issue in the repository.