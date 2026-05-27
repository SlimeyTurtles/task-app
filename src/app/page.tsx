// Proxy in src/proxy.ts redirects "/" to "/today" for authenticated users
// and "/login" for everyone else, so this component is essentially never seen.
export default function RootPage() {
  return null;
}
