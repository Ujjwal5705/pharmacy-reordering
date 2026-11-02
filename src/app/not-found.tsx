import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-brand underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}
