"use client";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, onAuthStateChanged, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Image } from 'next/image';


// Global variables provided by the Canvas environment
const appId = 'fish-tracker-778bf';
const firebaseConfig = {
  apiKey: "AIzaSyB6zi3UJu7lZ39HaUzwLJTZOBU-UtUH0A0",
  authDomain: "fish-tracker-778bf.firebaseapp.com",
  projectId: "fish-tracker-778bf",
  storageBucket: "fish-tracker-778bf.firebasestorage.app",
  messagingSenderId: "324791791965",
  appId: "1:324791791965:web:9f49ace037936e01b1f8b4",
  measurementId: "G-ZXZF6EX9JE"
};

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const provider = new GoogleAuthProvider();

// Helper function to convert base64 to ArrayBuffer (for audio playback, if needed later)
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper function to convert PCM audio to WAV format (for audio playback, if needed later)
function pcmToWav(pcmData, sampleRate) {
  const numChannels = 1; // Mono audio
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // RIFF chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.byteLength, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // FMT chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample

  // DATA chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.byteLength, true); // Subchunk2Size

  const combined = new Uint8Array(wavHeader.byteLength + pcmData.byteLength);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(new Uint8Array(pcmData.buffer), wavHeader.byteLength);

  return new Blob([combined], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Custom Tooltip Component for Recharts
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const fishDataPoint = payload.find(p => p.dataKey === 'Cumulative Fish Value');

    if (fishDataPoint && fishDataPoint.payload) {
      const originalFish = fishDataPoint.payload.originalFish;
      if (originalFish) {
        return (
          <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
            <p className="text-gray-900 font-bold mb-1">{`Date: ${label}`}</p>
            <p className="text-gray-700 text-sm">{`Species: ${originalFish.species}`}</p>
            <p className="text-gray-700 text-sm">{`Weight: ${originalFish.weight.toFixed(1)} lbs`}</p>
            <p className="text-gray-700 text-sm">{`Value: $${originalFish.estimatedValue.toFixed(2)}`}</p>
            {originalFish.location && <p className="text-gray-700 text-sm">{`Location: ${originalFish.location}`}</p>}
            {originalFish.imageUrl ? (
              <Image
                src={originalFish.imageUrl}
                alt={originalFish.species}
                className="w-24 h-24 object-cover rounded-md mt-2"
                onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/96x96/cccccc/000000?text=No+Image"; }}
              />
            ) : (
              <div className="w-24 h-24 bg-gray-200 rounded-md flex items-center justify-center text-xs text-gray-500 text-center mt-2">
                No Image
              </div>
            )}
          </div>
        );
      }
    }
  }
  return null;
};


function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [storage, setStorage] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [fishCatches, setFishCatches] = useState([]);
  const [gearPurchases, setGearPurchases] = useState([]);
  const [activeTab, setActiveTab] = useState('catches');

  // Fish input states
  const [species, setSpecies] = useState('');
  const [weight, setWeight] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [dateCaughtInput, setDateCaughtInput] = useState(new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState('');
  const [fishImageFile, setFishImageFile] = useState(null);
  const [uploadingFishImage, setUploadingFishImage] = useState(false);
  const [editingFish, setEditingFish] = useState(null);
  const [currentFishImagePreview, setCurrentFishImagePreview] = useState('');

  // Gear input states
  const [gearName, setGearName] = useState('');
  const [gearPrice, setGearPrice] = useState('');
  const [gearDateInput, setGearDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [editingGear, setEditingGear] = useState(null);

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  // Initialize Firebase and set up auth listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      const firebaseStorage = getStorage(app);
      setDb(firestore);
      setAuth(firebaseAuth);
      setStorage(firebaseStorage);

      onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
        }
      });
    } catch (error) {
      console.error("Error initializing Firebase:", error);
      setMessage(`Firebase initialization failed: ${error.message}`);
      setMessageType('error');
    }
  }, []);


  // Fetch fish catches when auth is ready
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const fishCollectionRef = collection(db, `artifacts/${appId}/fishCatches`);
    const q = query(fishCollectionRef, orderBy('dateCaught', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const catches = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        dateCaught: doc.data().dateCaught?.toDate() || new Date()
      }));
      catches.sort((a, b) => a.dateCaught.getTime() - b.dateCaught.getTime());
      setFishCatches(catches);
    }, (error) => {
      console.error("Error fetching fish catches:", error);
      setMessage(`Error loading catches: ${error.message}`);
      setMessageType('error');
    });

    return () => unsubscribe();
  }, [db, userId, isAuthReady]);

  // Fetch gear purchases when auth is ready
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const gearCollectionRef = collection(db, `artifacts/${appId}/gearPurchases`);
    const q = query(gearCollectionRef, orderBy('datePurchased', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const gear = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        datePurchased: doc.data().datePurchased?.toDate() || new Date()
      }));
      gear.sort((a, b) => a.datePurchased.getTime() - b.datePurchased.getTime());
      setGearPurchases(gear);
    }, (error) => {
      console.error("Error fetching gear purchases:", error);
      setMessage(`Error loading gear: ${error.message}`);
      setMessageType('error');
    });

    return () => unsubscribe();
  }, [db, userId, isAuthReady]);


  const handleFishFileChange = (e) => {
    if (e.target.files[0]) {
      setFishImageFile(e.target.files[0]);
      setCurrentFishImagePreview(URL.createObjectURL(e.target.files[0]));
    } else {
      setFishImageFile(null);
      if (editingFish) {
        setCurrentFishImagePreview(editingFish.imageUrl || '');
      } else {
        setCurrentFishImagePreview('');
      }
    }
  };

  const handleSubmitFish = async (e) => {
    e.preventDefault();
    if (!db || !userId || !storage) {
      setMessage('Firebase services not ready or user not authenticated.');
      setMessageType('error');
      return;
    }

    if (!species || !weight || !estimatedValue || !dateCaughtInput || !location) {
      setMessage('Please fill in all required fish fields.');
      setMessageType('error');
      return;
    }

    setUploadingFishImage(true);
    let finalImageUrl = editingFish ? editingFish.imageUrl : '';
    let finalImagePath = editingFish ? editingFish.imagePath : '';

    try {
      if (fishImageFile) {
        if (editingFish && editingFish.imagePath) {
          try {
            const oldImageRef = ref(storage, editingFish.imagePath);
            await deleteObject(oldImageRef);
          } catch (error) {
            if (error.code !== 'storage/object-not-found') {
              console.warn("Could not delete old fish image:", error);
            }
          }
        }

        const storageRef = ref(storage, `artifacts/${appId}/fish_images/${fishImageFile.name}-${Date.now()}`);
        const uploadResult = await uploadBytes(storageRef, fishImageFile);
        finalImageUrl = await getDownloadURL(uploadResult.ref);
        finalImagePath = uploadResult.ref.fullPath;
      } else if (editingFish && !fishImageFile && !currentFishImagePreview) {
        if (editingFish.imagePath) {
          try {
            const oldImageRef = ref(storage, editingFish.imagePath);
            await deleteObject(oldImageRef);
          } catch (error) {
            if (error.code !== 'storage/object-not-found') {
              console.warn("Could not delete old fish image:", error);
            }
          }
        }
        finalImageUrl = '';
        finalImagePath = '';
      }


      const fishData = {
        species,
        weight: parseFloat(weight),
        estimatedValue: parseFloat(estimatedValue),
        dateCaught: new Date(dateCaughtInput),
        location,
        imageUrl: finalImageUrl,
        imagePath: finalImagePath,
        userId: userId,
      };

      if (editingFish) {
        const docRef = doc(db, `artifacts/${appId}/fishCatches`, editingFish.id);
        await updateDoc(docRef, fishData);
        setMessage('Fish catch updated successfully!');
      } else {
        const fishCollectionRef = collection(db, `artifacts/${appId}/fishCatches`);
        await addDoc(fishCollectionRef, fishData);
        setMessage('Fish added successfully!');
      }

      setMessageType('success');
      resetFishForm();
    } catch (error) {
      console.error("Error adding/updating fish or uploading image:", error);
      setMessage(`Error: ${error.message}`);
      setMessageType('error');
    } finally {
      setUploadingFishImage(false);
    }
  };

  const handleSubmitGear = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      setMessage('Firebase services not ready or user not authenticated.');
      setMessageType('error');
      return;
    }

    if (!gearName || !gearPrice || !gearDateInput) {
      setMessage('Please fill in all required gear fields.');
      setMessageType('error');
      return;
    }

    try {
      const gearData = {
        name: gearName,
        price: parseFloat(gearPrice),
        datePurchased: new Date(gearDateInput),
        userId: userId,
      };

      if (editingGear) {
        const docRef = doc(db, `artifacts/${appId}}/gearPurchases`, editingGear.id);
        await updateDoc(docRef, gearData);
        setMessage('Gear item updated successfully!');
      } else {
        const gearCollectionRef = collection(db, `artifacts/${appId}/gearPurchases`);
        await addDoc(gearCollectionRef, gearData);
        setMessage('Gear added successfully!');
      }

      setMessageType('success');
      resetGearForm();
    } catch (error) {
      console.error("Error adding/updating gear:", error);
      setMessage(`Error: ${error.message}`);
      setMessageType('error');
    } finally {
    }
  };

  // Reset functions
  const resetFishForm = () => {
    setSpecies('');
    setWeight('');
    setEstimatedValue('');
    setDateCaughtInput(new Date().toISOString().split('T')[0]);
    setLocation('');
    setFishImageFile(null);
    setEditingFish(null);
    setCurrentFishImagePreview('');
  };

  const resetGearForm = () => {
    setGearName('');
    setGearPrice('');
    setGearDateInput(new Date().toISOString().split('T')[0]);
    setEditingGear(null);
  };

  // Edit functions
  const handleEditFish = (fish) => {
    setEditingFish(fish);
    setSpecies(fish.species);
    setWeight(fish.weight);
    setEstimatedValue(fish.estimatedValue);
    setDateCaughtInput(fish.dateCaught.toISOString().split('T')[0]);
    setLocation(fish.location || '');
    setFishImageFile(null);
    setCurrentFishImagePreview(fish.imageUrl || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditGear = (gear) => {
    setEditingGear(gear);
    setGearName(gear.name);
    setGearPrice(gear.price);
    setGearDateInput(gear.datePurchased.toISOString().split('T')[0]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  // Delete functions
  const handleDeleteFish = async (id, imageUrl, imagePath) => {
    if (!db || !userId || !storage) {
      setMessage('Firebase services not ready or user not authenticated.');
      setMessageType('error');
      return;
    }

    if (window.confirm("Are you sure you want to delete this fish catch?")) {
      try {
        const docRef = doc(db, `artifacts/${appId}/fishCatches`, id);
        await deleteDoc(docRef);

        if (imagePath) {
          const imageRef = ref(storage, imagePath);
          await deleteObject(imageRef).catch((error) => {
            if (error.code !== 'storage/object-not-found') {
              console.error("Error deleting fish image from storage:", error);
              setMessage(`Error deleting image: ${error.message}`);
              setMessageType('error');
            }
          });
        }
        setMessage('Fish catch deleted successfully!');
        setMessageType('success');
      } catch (error) {
        console.error("Error deleting fish catch:", error);
        setMessage(`Error deleting fish catch: ${error.message}`);
        setMessageType('error');
      }
    }
  };

  const handleDeleteGear = async (id, imageUrl, imagePath) => {
    if (!db || !userId) {
      setMessage('Firebase services not ready or user not authenticated.');
      setMessageType('error');
      return;
    }

    if (window.confirm("Are you sure you want to delete this gear item?")) {
      try {
        const docRef = doc(db, `artifacts/${appId}/gearPurchases`, id);
        await deleteDoc(docRef);

        setMessage('Gear item deleted successfully!');
        setMessageType('success');
      } catch (error) {
        console.error("Error deleting gear item:", error);
        setMessage(`Error deleting gear item: ${error.message}`);
        setMessageType('error');
      }
    }
  };


  const totalFishValue = fishCatches.reduce((sum, fish) => sum + (fish.estimatedValue || 0), 0);
  const totalGearCost = gearPurchases.reduce((sum, gear) => sum + (gear.price || 0), 0);
  const totalInvestment = totalGearCost;
  const payoffPercentage = (totalFishValue / (totalInvestment || 1)) * 100;

  // Prepare data for the chart, including the original fish object for the tooltip
  const chartData = useMemo(() => {
    let cumulativeFishValue = 0;
    const data = [];

    fishCatches.forEach((fish) => {
      cumulativeFishValue += fish.estimatedValue;

      const currentInvestmentAtDate = gearPurchases
        .filter(gear => gear.datePurchased.getTime() <= fish.dateCaught.getTime())
        .reduce((sum, gear) => sum + (gear.price || 0), 0);

      data.push({
        date: fish.dateCaught.toLocaleDateString(),
        'Cumulative Fish Value': cumulativeFishValue,
        'Total Investment': currentInvestmentAtDate,
        originalFish: fish,
      });
    });
    return data;
  }, [fishCatches, gearPurchases]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-green-100 p-4 font-inter">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-6 md:p-8">
        <h1 className="text-3xl md:text-4xl font-bold text-center text-blue-800 mb-6">
          🐟 Fishing Payoff Tracker 🎣
        </h1>

        {message && (
          <div className={`p-3 mb-4 rounded-lg text-center ${messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {message}
          </div>
        )}

        {!userId && (<button id="loginButton" onClick={() => signInWithPopup(auth, provider)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105 shadow-md mb-6">Sign-in (Required to view and add new data)</button>)}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Payoff Summary */}
          <div className="bg-green-50 p-5 rounded-lg shadow-md col-span-full">
            <h2 className="text-xl font-semibold text-green-700 mb-3">Payoff Progress</h2>
            <p className="text-gray-700 text-lg">
              Total Fish Value: <span className="font-bold text-green-600">${totalFishValue.toFixed(2)}</span>
            </p>
            <p className="text-gray-700 text-lg">
              Total Gear Investment: <span className="font-bold text-blue-600">${totalInvestment.toFixed(2)}</span>
            </p>
            <p className="text-2xl font-bold mt-3">
              Paid Off: <span className={`
                                ${payoffPercentage >= 100 ? 'text-green-700' : payoffPercentage >= 50 ? 'text-yellow-600' : 'text-red-600'}
                            `}>
                {payoffPercentage.toFixed(2)}%
              </span>
            </p>
          </div>
        </div>

        {/* Debt Payoff Graph */}
        <div className="bg-white p-6 rounded-xl shadow-md mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Fishing Payoff Progress Graph</h2>
          {chartData.length === 0 ? (
            <p className="text-gray-600 text-center py-4">Add some catches to see your payoff progress!</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Cumulative Fish Value"
                  stroke="#22C55E"
                  activeDot={{ r: 8 }}
                  strokeWidth={3}
                />
                <Line
                  type="stepAfter"
                  dataKey="Total Investment"
                  stroke="#3B82F6"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Add/Edit Fish Form */}
        <form onSubmit={handleSubmitFish} className="bg-gray-50 p-6 rounded-xl shadow-md mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {editingFish ? 'Edit Fish Catch' : 'Log a New Catch'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
            <div>
              <label htmlFor="species" className="block text-gray-700 text-sm font-bold mb-2">Species</label>
              <input
                type="text"
                id="species"
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Salmon"
                required
              />
            </div>
            <div>
              <label htmlFor="weight" className="block text-gray-700 text-sm font-bold mb-2">Weight (lbs)</label>
              <input
                type="number"
                id="weight"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 10.5"
                step="0.1"
                required
              />
            </div>
            <div>
              <label htmlFor="estimatedValue" className="block text-gray-700 text-sm font-bold mb-2">Value ($)</label>
              <input
                type="number"
                id="estimatedValue"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 75.00"
                step="0.01"
                required
              />
            </div>
            <div>
              <label htmlFor="dateCaught" className="block text-gray-700 text-sm font-bold mb-2">Date Caught</label>
              <input
                type="date"
                id="dateCaught"
                value={dateCaughtInput}
                onChange={(e) => setDateCaughtInput(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label htmlFor="location" className="block text-gray-700 text-sm font-bold mb-2">Location</label>
              <input
                type="text"
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Hoodsport Fishery" // Changed placeholder
                required
              />
            </div>
            <div>
              <label htmlFor="fishImageUpload" className="block text-gray-700 text-sm font-bold mb-2">Photo (Optional)</label>
              <input
                type="file"
                id="fishImageUpload"
                accept="image/*"
                onChange={handleFishFileChange}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {fishImageFile && <p className="text-xs text-gray-500 mt-1">Selected: {fishImageFile.name}</p>}
              {currentFishImagePreview && !fishImageFile && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Current Image:</p>
                  <Image src={currentFishImagePreview} alt="Current Fish" className="w-16 h-16 object-cover rounded-md" />
                  <button
                    type="button"
                    onClick={() => setCurrentFishImagePreview('')}
                    className="text-red-500 text-xs mt-1 hover:underline"
                  >
                    Remove Current Image
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex space-x-4">
            <button
              type="submit"
              className="flex-grow bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
              disabled={uploadingFishImage}
            >
              {uploadingFishImage ? 'Uploading Image...' : (editingFish ? 'Update Catch' : 'Add Catch')}
            </button>
            {editingFish && (
              <button
                type="button"
                onClick={resetFishForm}
                className="flex-grow bg-gray-400 hover:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                disabled={uploadingFishImage}
              >
                Cancel Edit
              </button>
            )}
          </div>
          {uploadingFishImage && (
            <div className="mt-4 text-center text-blue-600 font-medium">
              Please wait, uploading image...
            </div>
          )}
        </form>

        {/* Add/Edit Gear Form */}
        <form onSubmit={handleSubmitGear} className="bg-gray-50 p-6 rounded-xl shadow-md mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {editingGear ? 'Edit Gear Item' : 'Log New Gear'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label htmlFor="gearName" className="block text-gray-700 text-sm font-bold mb-2">Gear Name</label>
              <input
                type="text"
                id="gearName"
                value={gearName}
                onChange={(e) => setGearName(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Fishing Rod"
                required
              />
            </div>
            <div>
              <label htmlFor="gearPrice" className="block text-gray-700 text-sm font-bold mb-2">Price ($)</label>
              <input
                type="number"
                id="gearPrice"
                value={gearPrice}
                onChange={(e) => setGearPrice(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 120.00"
                step="0.01"
                required
              />
            </div>
            <div>
              <label htmlFor="gearDate" className="block text-gray-700 text-sm font-bold mb-2">Date Purchased</label>
              <input
                type="date"
                id="gearDate"
                value={gearDateInput}
                onChange={(e) => setGearDateInput(e.target.value)}
                className="shadow appearance-none border border-gray-300 rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>
          <div className="flex space-x-4">
            <button
              type="submit"
              className="flex-grow bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
            >
              {editingGear ? 'Update Gear' : 'Add Gear'}
            </button>
            {editingGear && (
              <button
                type="button"
                onClick={resetGearForm}
                className="flex-grow bg-gray-400 hover:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-6">
          <button
            onClick={() => setActiveTab('catches')}
            className={`py-2 px-6 rounded-l-lg font-semibold transition duration-300 ease-in-out
                            ${activeTab === 'catches' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            Your Catches
          </button>
          <button
            onClick={() => setActiveTab('gear')}
            className={`py-2 px-6 rounded-r-lg font-semibold transition duration-300 ease-in-out
                            ${activeTab === 'gear' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            Your Gear
          </button>
        </div>

        {/* Conditional Rendering of Tabs */}
        {activeTab === 'catches' && (
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Catches</h2>
            {fishCatches.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No fish caught yet. Start logging!</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tl-lg">
                        Image
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Species
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Weight (lbs)
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Value ($)
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Location
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tr-lg">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {fishCatches.slice(0).reverse().map((fish) => (
                      <tr key={fish.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {fish.imageUrl ? (
                            <Image
                              src={fish.imageUrl}
                              alt={fish.species}
                              className="w-16 h-16 object-cover rounded-md"
                              onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/64x64/cccccc/000000?text=No+Image"; }}
                            />
                          ) : (
                            <div className="w-16 h-16 bg-gray-200 rounded-md flex items-center justify-center text-xs text-gray-500 text-center">
                              No Image
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {fish.species}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {fish.weight.toFixed(1)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          ${fish.estimatedValue.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {fish.dateCaught.toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {fish.location}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleEditFish(fish)}
                            className="text-blue-600 hover:text-blue-900 font-semibold mr-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteFish(fish.id, fish.imageUrl, fish.imagePath)}
                            className="text-red-600 hover:text-red-900 font-semibold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'gear' && (
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Gear</h2>
            {gearPurchases.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No gear logged yet. Add your fishing essentials!</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tl-lg">
                        Name
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Price ($)
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date Purchased
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-tr-lg">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {gearPurchases.map((gear) => (
                      <tr key={gear.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {gear.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          ${gear.price.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {gear.datePurchased.toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleEditGear(gear)}
                            className="text-blue-600 hover:text-blue-900 font-semibold mr-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteGear(gear.id, gear.imageUrl, gear.imagePath)}
                            className="text-red-600 hover:text-red-900 font-semibold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center text-gray-500 text-sm">
          Your User ID: <span className="font-mono text-gray-700 break-all">{userId}</span>
          <p className="mt-2">This ID helps store your data securely.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
