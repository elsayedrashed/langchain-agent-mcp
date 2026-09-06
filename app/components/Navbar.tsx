import Link from 'next/link';

const Navbar = () => {
  return (
    <nav className="w-full mx-auto flex justify-between items-center px-4 py-2">
      <Link href="/" className="text-2xl font-bold text-gray-800">
        ✴️ Astra AI
      </Link>
    </nav>
  );
};
export default Navbar;
