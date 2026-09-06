import React from 'react';
import ChatBubble from './ChatBubble';
import ChatBubbleLoading from './ChatBubbleLoading';

type ChatPart = {
  type?: string;
  text?: string;
  output?: {
    content?: ChatPart[];
  };
};

type ChatMessage = {
  id: string;
  role: string;
  content?: string;
  parts?: ChatPart[];
};

type ChatListProps = {
  messages: ChatMessage[];
  isLoading: boolean;
};

function extractTextFromParts(parts?: ChatPart[]): string {
  if (!parts || !Array.isArray(parts)) return '';
  let text = '';
  for (const part of parts) {
    if (!part) continue;
    if (part.type === 'text' && part.text) {
      text += part.text + ' ';
    } else if (part.type === 'dynamic-tool' && part.output?.content) {
      text += extractTextFromParts(part.output.content) + ' ';
    } else if (part.output?.content && Array.isArray(part.output.content)) {
      text += extractTextFromParts(part.output.content) + ' ';
    }
  }
  return text.trim();
}

const ChatList = ({ messages, isLoading }: ChatListProps) => {
  return (
    <ul className="flex flex-col gap-5">
      {messages.map((message) => {
        const text =
          message?.content && message.content.trim()
            ? message.content
            : extractTextFromParts(message?.parts) || '';

        return (
          <li key={message?.id}>
            <ChatBubble
              role={message.role}
              text={text}
              className={`${message.role === 'assistant' ? 'mr-auto' : 'ml-auto'} border-none`}
            />
          </li>
        );
      })}
      {isLoading ? (
        <li key={messages.length + 1}>
          <ChatBubbleLoading />
        </li>
      ) : null}
    </ul>
  );
};

export default ChatList;
