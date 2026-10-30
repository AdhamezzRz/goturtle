import { Route, Routes } from 'react-router-dom';

export default function CustomerApp() {
  return (
    <Routes>
      <Route path="*" element={<p className="p-6">Tracking</p>} />
    </Routes>
  );
}
