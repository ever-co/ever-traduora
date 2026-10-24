declare module '@theme/Layout' {
  export interface Props {
    readonly title?: string;
    readonly description?: string;
  }
}

declare module '@theme/Heading' {
  type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  // Hoisted to a named alias because prettier's TS parser can't
  // handle the `interface X extends import('...').Y<Z>` form
  // (SyntaxError: "Interface declaration can only extend an
  // identifier/qualified name with optional type arguments").
  type HeadingComponentProps = import('react').ComponentProps<HeadingTag>;
  export interface Props extends HeadingComponentProps {
    readonly as: HeadingTag;
    readonly children?: import('react').ReactNode;
    readonly className?: string;
    readonly id?: string;
  }
  export default function Heading(props: Props): JSX.Element;
}

declare module '@theme/Tabs' {
  export interface Props {
    readonly children?: import('react').ReactNode;
    readonly groupId?: string;
    readonly className?: string;
  }
  export default function Tabs(props: Props): JSX.Element;
}

declare module '@theme/TabItem' {
  export interface Props {
    readonly children?: import('react').ReactNode;
    readonly value: string;
    readonly label?: import('react').ReactNode;
    readonly default?: boolean;
    readonly className?: string;
  }
  export default function TabItem(props: Props): JSX.Element;
}

declare module '@theme/CodeBlock' {
  export interface Props {
    readonly children?: import('react').ReactNode;
    readonly language?: string;
    readonly title?: string;
    readonly className?: string;
  }
  export default function CodeBlock(props: Props): JSX.Element;
}

declare module '@theme/Footer/Copyright' {
  export interface Props {
    readonly copyright?: string;
  }
  export default function FooterCopyright(props: Props): JSX.Element;
}

declare module '@theme/SearchBar' {
  export default function SearchBar(): JSX.Element;
}
