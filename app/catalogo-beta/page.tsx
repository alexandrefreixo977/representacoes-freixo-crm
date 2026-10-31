import { redirect } from 'next/navigation';

// Retired module: old bookmarks return to the CRM without loading catalog data.
export default function RetiredCatalogPage(){
  redirect('/dashboard');
}
