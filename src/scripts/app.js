document.addEventListener('DOMContentLoaded', () => {
    // Ensure Supabase SDK is available
    if (!window.supabase) {
        console.error('Supabase SDK not loaded. Check CDN.');
        alert('Failed to load Supabase. Please refresh the page.');
        return;
    }

    // Initialize Supabase
    let supabase;
    try {
        supabase = window.supabase.createClient(
            'https://jltpyjmgurmjvmnquzsz.supabase.co',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdHB5am1ndXJtanZtbnF1enN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwNzg2MzcsImV4cCI6MjA2NTY1NDYzN30.N5uvcHEcID7cURKwVNg9D916hAE6V7I6MM2coIQ2Ee8'
        );
        console.log('Supabase initialized:', supabase);
    } catch (error) {
        console.error('Supabase initialization failed:', error);
        alert('Failed to initialize Supabase. Please try again later.');
        return;
    }

    // DOM elements
    const navToggle = document.getElementById('nav-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const filterBtn = document.getElementById('filter-btn');
    const mobileFilterBtn = document.getElementById('mobile-filter-btn');
    const filterModal = document.getElementById('filter-modal');
    const closeFilterBtn = document.getElementById('close-filter-btn');
    const filterForm = document.getElementById('filter-form');
    const budgetSlider = document.getElementById('budget');
    const budgetValue = document.getElementById('budget-value');

    // Global state
    let userState = {
        painLevel: 'none',
        budget: 2000,
        energyLevel: 'normal',
        ingredients: [],
        excludeIngredients: false
    };
    let meals = [];
    let favorites = [];
    let blacklisted = [];
    let favoriteSort = 'name';
    let favoriteFilter = { painLevel: 'all', tag: 'all' };

    // Load userState from localStorage
    function loadUserState() {
        const savedState = localStorage.getItem('userState');
        if (savedState) {
            userState = JSON.parse(savedState);
            document.getElementById('pain-level').value = userState.painLevel;
            budgetSlider.value = userState.budget;
            budgetValue.textContent = `₦${userState.budget}`;
            document.getElementById('energy-level').value = userState.energyLevel;
            document.getElementById('ingredients').value = userState.ingredients.join(', ');
            document.getElementById('exclude-ingredients').checked = userState.excludeIngredients;
        }
    }

    // Save userState to localStorage
    function saveUserState() {
        localStorage.setItem('userState', JSON.stringify(userState));
    }

    // Load favorites from localStorage
    function loadFavorites() {
        const savedFavorites = localStorage.getItem('favorites');
        if (savedFavorites) {
            favorites = JSON.parse(savedFavorites);
        }
    }

    // Save favorites to localStorage
    function saveFavorites() {
        localStorage.setItem('favorites', JSON.stringify(favorites));
    }

    // Load blacklisted meals from localStorage
    function loadBlacklisted() {
        const savedBlacklisted = localStorage.getItem('blacklisted');
        if (savedBlacklisted) {
            blacklisted = JSON.parse(savedBlacklisted);
            const now = Date.now();
            blacklisted = blacklisted.filter(item => item.expires > now);
            saveBlacklisted();
        }
    }

    // Save blacklisted meals to localStorage
    function saveBlacklisted() {
        localStorage.setItem('blacklisted', JSON.stringify(blacklisted));
    }

    // Toggle favorite status
    function toggleFavorite(mealName) {
        if (favorites.includes(mealName)) {
            favorites = favorites.filter(name => name !== mealName);
        } else {
            favorites.push(mealName);
        }
        saveFavorites();
        navigate();
    }

    // Blacklist a meal for 24 hours
    function blacklistMeal(mealName) {
        const expires = Date.now() + 24 * 60 * 60 * 1000;
        blacklisted.push({ name: mealName, expires });
        saveBlacklisted();
        navigate();
    }

    // Load meals from JSON and Supabase
    async function loadMeals() {
        try {
            // Load from meals.json
            const response = await fetch('/public/data/meals.json');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const jsonMeals = await response.json();

            // Load from Supabase
            const { data: supabaseMeals, error } = await supabase.from('recipes').select('*');
            if (error) throw error;

            const supabaseFormattedMeals = supabaseMeals.map(meal => ({
                name: meal.name,
                painLevel: meal.pain_level,
                budget: meal.budget,
                timeToCook: meal.time_to_cook,
                ingredients: meal.ingredients,
                tags: meal.tags,
                steps: meal.steps,
                imageUrl: meal.image_url,
                source: 'supabase',
                id: meal.id
            }));

            meals = [...jsonMeals, ...supabaseFormattedMeals];
        } catch (error) {
            console.error('Error loading meals:', error);
            meals = [];
            if (window.location.pathname === '/home') {
                document.getElementById('content').innerHTML = `
             <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
               <h1 class="text-2xl font-bold">Meal Suggestions</h1>
               <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
             </header>
             <div class="bg-white p-6 rounded-b-lg shadow-md">
               <p class="text-gray-600">Unable to load meals. Please try again later.</p>
             </div>
           `;
            }
        }
    }

    // Filter meals based on userState
    function filterMeals() {
        return meals.filter(meal => {
            const painMatch = userState.painLevel === 'active' || meal.painLevel === userState.painLevel || meal.painLevel === 'none';
            const budgetMatch = meal.budget <= userState.budget;
            const energyMatch = userState.energyLevel === 'normal' ||
                (userState.energyLevel === 'low' && meal.timeToCook <= 30) ||
                (userState.energyLevel === 'very-low' && meal.timeToCook <= 15);
            let ingredientMatch = true;
            if (userState.ingredients.length > 0) {
                if (userState.excludeIngredients) {
                    ingredientMatch = !userState.ingredients.some(ing =>
                        meal.ingredients.some(mealIng =>
                            mealIng.toLowerCase().includes(ing.toLowerCase())
                        )
                    );
                } else {
                    ingredientMatch = userState.ingredients.every(ing =>
                        meal.ingredients.some(mealIng =>
                            mealIng.toLowerCase().includes(ing.toLowerCase())
                        )
                    );
                }
            }
            const notBlacklisted = !blacklisted.some(item => item.name === meal.name && item.expires > Date.now());
            return painMatch && budgetMatch && energyMatch && ingredientMatch && notBlacklisted;
        });
    }

    // Filter and sort favorites
    function filterAndSortFavorites() {
        let favoriteMeals = meals.filter(meal => favorites.includes(meal.name));

        // Apply filters
        if (favoriteFilter.painLevel !== 'all') {
            favoriteMeals = favoriteMeals.filter(meal => meal.painLevel === favoriteFilter.painLevel);
        }
        if (favoriteFilter.tag !== 'all') {
            favoriteMeals = favoriteMeals.filter(meal => meal.tags.includes(favoriteFilter.tag));
        }

        // Apply sorting
        favoriteMeals.sort((a, b) => {
            if (favoriteSort === 'name') {
                return a.name.localeCompare(b.name);
            } else if (favoriteSort === 'budget') {
                return a.budget - b.budget;
            } else if (favoriteSort === 'time') {
                return a.timeToCook - b.timeToCook;
            }
            return 0;
        });

        return favoriteMeals;
    }

    // Shuffle array
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Handle recipe submission
    async function handleRecipeSubmit(e) {
        e.preventDefault();
        const mealName = document.getElementById('meal-name').value.trim();
        const ingredients = document.getElementById('meal-ingredients').value
            .split(',')
            .map(ing => ing.trim())
            .filter(ing => ing.length > 0);
        const steps = document.getElementById('meal-steps').value.trim();
        const painLevel = document.getElementById('meal-pain-level').value;
        const budget = parseInt(document.getElementById('meal-budget').value);
        const timeToCook = parseInt(document.getElementById('meal-time').value);
        const imageFile = document.getElementById('meal-image').files[0];

        if (!mealName || ingredients.length === 0 || !steps) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            // Sign in anonymously
            const { error: authError } = await supabase.auth.signInAnonymously();
            if (authError) throw authError;

            // Upload image if provided
            let imageUrl = 'https://via.placeholder.com/150';
            if (imageFile) {
                const { data, error } = await supabase.storage
                    .from('recipe-images')
                    .upload(`images/${Date.now()}_${imageFile.name}`, imageFile);
                if (error) throw error;
                imageUrl = supabase.storage.from('recipe-images').getPublicUrl(data.path).data.publicUrl;
            }

            // Generate tags
            const tags = [];
            if (painLevel === 'none' || painLevel === 'mild') tags.push('pain-safe');
            if (budget <= 1500) tags.push('low-cost');
            else tags.push('medium-cost');
            if (timeToCook <= 15) tags.push('quick');

            // Save to Supabase
            const { error } = await supabase.from('recipes').insert({
                name: mealName,
                pain_level: painLevel,
                budget,
                time_to_cook: timeToCook,
                ingredients,
                tags,
                steps,
                image_url: imageUrl
            });
            if (error) throw error;

            alert('Recipe submitted successfully!');
            document.getElementById('recipe-form').reset();
            await loadMeals(); // Reload meals
            navigate();
        } catch (error) {
            console.error('Error submitting recipe:', error);
            alert('Failed to submit recipe. Please try again.');
        }
    }

    // Initialize state and data
    loadUserState();
    loadFavorites();
    loadBlacklisted();
    loadMeals();

    // Mobile Nav Toggle
    navToggle.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });

    // Filter Modal Open/Close
    filterBtn.addEventListener('click', () => {
        filterModal.classList.remove('hidden');
    });

    mobileFilterBtn.addEventListener('click', () => {
        filterModal.classList.remove('hidden');
    });

    closeFilterBtn.addEventListener('click', () => {
        filterModal.classList.add('hidden');
    });

    // Budget Slider Update
    budgetSlider.addEventListener('input', () => {
        budgetValue.textContent = `₦${budgetSlider.value}`;
    });

    // Filter Form Submission
    filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        userState.painLevel = document.getElementById('pain-level').value;
        userState.budget = parseInt(budgetSlider.value);
        userState.energyLevel = document.getElementById('energy-level').value;
        const ingredientsInput = document.getElementById('ingredients').value;
        userState.ingredients = ingredientsInput
            .split(',')
            .map(ing => ing.trim())
            .filter(ing => ing.length > 0);
        userState.excludeIngredients = document.getElementById('exclude-ingredients').checked;
        saveUserState();
        filterModal.classList.add('hidden');
        navigate();
    });

    // SPA Router with pushState
    const routes = {
        '/home': () => {
            let filteredMeals = filterMeals();
            if (document.getElementById('shuffle-btn') && document.getElementById('shuffle-btn').dataset.shuffled === 'true') {
                filteredMeals = shuffleArray([...filteredMeals]);
            }
            const mealCards = filteredMeals.length > 0
                ? filteredMeals.map(meal => `
               <div class="bg-white p-4 rounded-lg shadow-md">
                 <img src="${meal.imageUrl || 'https://via.placeholder.com/150'}" alt="${meal.name}" class="w-full h-32 object-cover rounded-t-lg">
                 <div class="flex justify-between items-center mt-2">
                   <h3 class="text-lg font-semibold text-teal-700">${meal.name}</h3>
                   <button onclick="toggleFavorite('${meal.name}')" class="text-2xl">
                     ${favorites.includes(meal.name) ? '💖' : '🤍'}
                   </button>
                 </div>
                 <div class="flex flex-wrap gap-2 mt-2">
                   ${meal.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
                   <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">₦${meal.budget}</span>
                   <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${meal.timeToCook} min</span>
                 </div>
                 <button onclick="blacklistMeal('${meal.name}')" class="mt-2 w-full bg-gray-200 text-gray-700 p-2 rounded hover:bg-gray-300 text-sm">
                   Not now
                 </button>
               </div>
             `).join('')
                : `
               <div class="text-center text-gray-600 p-6">
                 <p>No meals match your filters. Don't worry, try adding some ingredients you have or loosening your filters! 💕</p>
               </div>
             `;
            return `
           <!-- Page Title/Header Bar -->
           <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
             <h1 class="text-2xl font-bold">Meal Suggestions</h1>
             <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
           </header>
           <!-- Main Content Box -->
           <div class="bg-white p-6 rounded-b-lg shadow-md">
             <div class="flex justify-between items-center mb-4">
               <p class="text-gray-600">Browse personalized meal suggestions based on your filters.</p>
               <button id="shuffle-btn" data-shuffled="false" class="bg-teal-600 text-white p-2 rounded hover:bg-teal-700">
                 <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
                 </svg>
               </button>
             </div>
             <p class="text-gray-600 mb-4">Current Filters: Pain: ${userState.painLevel}, Budget: ₦${userState.budget}, Energy: ${userState.energyLevel}${userState.ingredients.length > 0 ? `, Ingredients: ${userState.excludeIngredients ? 'exclude ' : ''}${userState.ingredients.join(', ')}` : ''}</p>
             <!-- Meal Cards -->
             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[calc(100vh-300px)] overflow-y-auto">
               ${mealCards}
             </div>
           </div>
         `;
        },
        '/favorites': () => {
            const favoriteMeals = filterAndSortFavorites();
            const uniqueTags = [...new Set(meals.flatMap(meal => meal.tags))];
            const mealCards = favoriteMeals.length > 0
                ? favoriteMeals.map(meal => `
               <div class="bg-white p-4 rounded-lg shadow-md">
                 <img src="${meal.imageUrl || 'https://via.placeholder.com/150'}" alt="${meal.name}" class="w-full h-32 object-cover rounded-t-lg">
                 <div class="flex justify-between items-center mt-2">
                   <h3 class="text-lg font-semibold text-teal-700">${meal.name}</h3>
                   <button onclick="toggleFavorite('${meal.name}')" class="text-2xl">
                     ${favorites.includes(meal.name) ? '💖' : '🤍'}
                   </button>
                 </div>
                 <div class="flex flex-wrap gap-2 mt-2">
                   ${meal.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
                   <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">₦${meal.budget}</span>
                   <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${meal.timeToCook} min</span>
                 </div>
               </div>
             `).join('')
                : `
               <div class="text-center text-gray-600 p-6">
                 <p>You haven't favorited any meals yet. Find some on the Home page! 💕</p>
               </div>
             `;
            return `
           <!-- Page Title/Header Bar -->
           <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
             <h1 class="text-2xl font-bold">Favorites</h1>
             <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
           </header>
           <!-- Main Content Box -->
           <div class="bg-white p-6 rounded-b-lg shadow-md">
             <p class="text-gray-600 mb-4">Your favorite ulcer-safe meals.</p>
             <!-- Sort and Filter Controls -->
             <div class="flex flex-wrap gap-4 mb-4">
               <div>
                 <label for="sort-favorites" class="block text-sm font-medium text-gray-700">Sort by</label>
                 <select id="sort-favorites" class="mt-1 block p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                   <option value="name" ${favoriteSort === 'name' ? 'selected' : ''}>Name</option>
                   <option value="budget" ${favoriteSort === 'budget' ? 'selected' : ''}>Budget</option>
                   <option value="time" ${favoriteSort === 'time' ? 'selected' : ''}>Time to Cook</option>
                 </select>
               </div>
               <div>
                 <label for="filter-pain-level" class="block text-sm font-medium text-gray-700">Pain Level</label>
                 <select id="filter-pain-level" class="mt-1 block p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                   <option value="all" ${favoriteFilter.painLevel === 'all' ? 'selected' : ''}>All</option>
                   <option value="none" ${favoriteFilter.painLevel === 'none' ? 'selected' : ''}>None</option>
                   <option value="mild" ${favoriteFilter.painLevel === 'mild' ? 'selected' : ''}>Mild</option>
                   <option value="active" ${favoriteFilter.painLevel === 'active' ? 'selected' : ''}>Active</option>
                 </select>
               </div>
               <div>
                 <label for="filter-tag" class="block text-sm font-medium text-gray-700">Tag</label>
                 <select id="filter-tag" class="mt-1 block p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                   <option value="all" ${favoriteFilter.tag === 'all' ? 'selected' : ''}>All</option>
                   ${uniqueTags.map(tag => `<option value="${tag}" ${favoriteFilter.tag === tag ? 'selected' : ''}>${tag}</option>`).join('')}
                 </select>
               </div>
             </div>
             <!-- Favorite Meal Cards -->
             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[calc(100vh-400px)] overflow-y-auto">
               ${mealCards}
             </div>
           </div>
         `;
        },
        '/add-meal': () => `
         <!-- Page Title/Header Bar -->
         <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
           <h1 class="text-2xl font-bold">Add a Meal</h1>
           <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
         </header>
         <!-- Main Content Box -->
         <div class="bg-white p-6 rounded-b-lg shadow-md">
           <p class="text-gray-600 mb-4">Share your ulcer-safe recipe with the community.</p>
           <form id="recipe-form" class="space-y-4">
             <!-- Meal Name -->
             <div>
               <label for="meal-name" class="block text-sm font-medium text-gray-700">Meal Name</label>
               <input type="text" id="meal-name" required class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., Creamy Oatmeal">
             </div>
             <!-- Ingredients -->
             <div>
               <label for="meal-ingredients" class="block text-sm font-medium text-gray-700">Ingredients (comma-separated)</label>
               <input type="text" id="meal-ingredients" required class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., oats, milk, banana">
             </div>
             <!-- Steps -->
             <div>
               <label for="meal-steps" class="block text-sm font-medium text-gray-700">Steps</label>
               <textarea id="meal-steps" required class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500" rows="4" placeholder="e.g., Boil water, add oats..."></textarea>
             </div>
             <!-- Pain Level -->
             <div>
               <label for="meal-pain-level" class="block text-sm font-medium text-gray-700">Pain Level</label>
               <select id="meal-pain-level" class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                 <option value="none">None</option>
                 <option value="mild">Mild</option>
                 <option value="active">Active</option>
               </select>
             </div>
             <!-- Budget -->
             <div>
               <label for="meal-budget" class="block text-sm font-medium text-gray-700">Budget (₦)</label>
               <select id="meal-budget" class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                 <option value="500">₦500</option>
                 <option value="1000">₦1000</option>
                 <option value="1500">₦1500</option>
                 <option value="2000">₦2000</option>
                 <option value="2500">₦2500</option>
               </select>
             </div>
             <!-- Time to Cook -->
             <div>
               <label for="meal-time" class="block text-sm font-medium text-gray-700">Time to Cook (minutes)</label>
               <select id="meal-time" class="mt-1 block w-full p-2 border border-gray-300 rounded focus:ring-teal-500 focus:border-teal-500">
                 <option value="5">5 min</option>
                 <option value="10">10 min</option>
                 <option value="15">15 min</option>
                 <option value="20">20 min</option>
                 <option value="30">30 min</option>
                 <option value="45">45 min</option>
               </select>
             </div>
             <!-- Image Upload -->
             <div>
               <label for="meal-image" class="block text-sm font-medium text-gray-700">Image (optional)</label>
               <input type="file" id="meal-image" accept="image/*" class="mt-1 block w-full p-2 border border-gray-300 rounded">
             </div>
             <!-- Submit Button -->
             <button type="submit" class="w-full bg-teal-600 text-white p-2 rounded hover:bg-teal-700">Submit Recipe</button>
           </form>
         </div>
       `,
        '/my-log': () => `
         <!-- Page Title/Header Bar -->
         <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
           <h1 class="text-2xl font-bold">My Log</h1>
           <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
         </header>
         <!-- Main Content Box -->
         <div class="bg-white p-6 rounded-b-lg shadow-md">
           <p class="text-gray-600">Track what you ate and how it affected your stomach.</p>
           <div class="mt-4">
             <div class="bg-gray-100 p-4 rounded">Log Entry 1</div>
             <div class="bg-gray-100 p-4 rounded mt-2">Log Entry 2</div>
           </div>
         </div>
       `,
        '/relief-hub': () => `
         <!-- Page Title/Header Bar -->
         <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
           <h1 class="text-2xl font-bold">Relief Hub</h1>
           <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
         </header>
         <!-- Main Content Box -->
         <div class="bg-white p-6 rounded-b-lg shadow-md">
           <p class="text-gray-600">Find quick relief tips, soothing teas, and emergency meals.</p>
           <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
             <div class="bg-gray-100 p-4 rounded">Relief Tip 1</div>
             <div class="bg-gray-100 p-4 rounded">Relief Tip 2</div>
           </div>
         </div>
       `,
        '/blogs': () => `
         <!-- Page Title/Header Bar -->
         <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
           <h1 class="text-2xl font-bold">Blogs</h1>
           <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
         </header>
         <!-- Main Content Box -->
         <div class="bg-white p-6 rounded-b-lg shadow-md">
           <p class="text-gray-600">Read community stories and experiences.</p>
           <div class="mt-4">
             <div class="bg-gray-100 p-4 rounded">Blog Post 1</div>
             <div class="bg-gray-100 p-4 rounded mt-2">Blog Post 2</div>
           </div>
         </div>
       `,
        '/settings': () => `
         <!-- Page Title/Header Bar -->
         <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
           <h1 class="text-2xl font-bold">Settings</h1>
           <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
         </header>
         <!-- Main Content Box -->
         <div class="bg-white p-6 rounded-b-lg shadow-md">
           <p class="text-gray-600">Customize your app experience.</p>
           <div class="mt-4">
             <div class="bg-gray-100 p-4 rounded">Settings Option 1</div>
             <div class="bg-gray-100 p-4 rounded mt-2">Settings Option 2</div>
           </div>
         </div>
       `,
    };

    const defaultRoute = '/home';

    function navigate() {
        const path = window.location.pathname || defaultRoute;
        const contentDiv = document.getElementById('content');
        const routeHandler = routes[path] || routes[defaultRoute];
        contentDiv.innerHTML = routeHandler();

        // Attach event listeners after rendering
        const shuffleBtn = document.getElementById('shuffle-btn');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => {
                shuffleBtn.dataset.shuffled = 'true';
                navigate();
                setTimeout(() => { shuffleBtn.dataset.shuffled = 'false'; }, 0);
            });
        }

        const recipeForm = document.getElementById('recipe-form');
        if (recipeForm) {
            recipeForm.addEventListener('submit', handleRecipeSubmit);
        }

        const sortFavorites = document.getElementById('sort-favorites');
        if (sortFavorites) {
            sortFavorites.addEventListener('change', (e) => {
                favoriteSort = e.target.value;
                navigate();
            });
        }

        const filterPainLevel = document.getElementById('filter-pain-level');
        if (filterPainLevel) {
            filterPainLevel.addEventListener('change', (e) => {
                favoriteFilter.painLevel = e.target.value;
                navigate();
            });
        }

        const filterTag = document.getElementById('filter-tag');
        if (filterTag) {
            filterTag.addEventListener('change', (e) => {
                favoriteFilter.tag = e.target.value;
                navigate();
            });
        }
    }

    // Handle navigation
    window.addEventListener('popstate', navigate);

    // Intercept link clicks for SPA routing
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href.startsWith(window.location.origin)) {
            e.preventDefault();
            const path = new URL(link.href).pathname;
            history.pushState({}, '', path);
            navigate();
        }
    });

    // Initial load
    navigate();
});