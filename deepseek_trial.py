import requests
import gradio as gr

AMA_URL = "http://localhost:11434/api/generate"

def summarize_text(text: str) -> str:
    """
    Sends the provided text to Deepseek for summarization via the API.
    
    Args:
        text (str): The text to summarize.
        
    Returns:
        str: The summarized text or an error message.
    """
    payload = {
        "model": "deepseek-r1:8b",
        "prompt": f"Summarize the following text:\n\n{text}",
        "stream": False
    }
    response = requests.post(AMA_URL, json=payload)
    if response.status_code == 200:
        return response.json().get("response", "No summary generated.")
    else:
        return f"Error: {response.text}"

# Create a simple Gradio interface
iface = gr.Interface(
    fn=summarize_text,
    inputs=gr.Textbox(lines=10, placeholder="Enter text to summarize..."),
    outputs=gr.Textbox(),
    title="AI-Powered Text Summarizer",
    description="Enter a long text and Deepseek AI will generate a concise summary."
)

if __name__ == "__main__":
    iface.launch()
