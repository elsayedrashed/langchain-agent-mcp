import { Card } from '@/components/ui/card';

type ChatBubbleProps = {
  role: string;
  text: string;
  className?: string;
  width?: string;
};

const ChatBubble = ({
  role,
  text,
  className = '',
  width = 'w-fit max-w-md',
}: ChatBubbleProps) => {
  return (
    <Card className={`p-5 flex flex-col gap-3 text-wrap break- border-none whitespace-pre-wrap ${width} ${className}`}>
      <h5 className="text-lg font-semibold">{role === 'assistant' ? `✴️ Astra` : `👤 ${role}`}</h5>
      <p>{text}</p>
    </Card>
  );
};

export default ChatBubble;
