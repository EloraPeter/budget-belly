document.addEventListener('DOMContentLoaded', () => {
  if (!window.supabase) {
    console.error('Supabase SDK not loaded. Check CDN.');
    showToast('Failed to load Supabase. Please refresh the page.', 'error');
    return;
  }

  let supabase;
  try {
    supabase = window.supabase.createClient(
      'https://jltpyjmgurmjvmnquzsz.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdHB5am1ndXJtanZtbnF1enN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwNzg2MzcsImV4cCI6MjA2NTY1NDYzN30.N5uvcHEcID7cURKwVNg9D916hAE6V7I6MM2coIQ2Ee8'
    );
    console.log('Supabase initialized:', supabase);
  } catch (error) {
    console.error('Supabase initialization failed:', error);
    showToast('Failed to initialize Supabase. Please try again later.', 'error');
    return;
  }

  const navToggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const filterBtn = document.getElementById('filter-btn');
  const mobileFilterBtn = document.getElementById('mobile-filter-btn');
  const filterModal = document.getElementById('filter-modal');
  const closeFilterBtn = document.getElementById('close-filter-btn');
  const filterForm = document.getElementById('filter-form');
  const budgetSlider = document.getElementById('budget');
  const budgetValue = document.getElementById('budget-value');

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
  let currentUserId = null;
  let commentSubscriptions = {};
  let pollingIntervals = {};

  let blogFilter = { tag: 'all' };

  async function handleBlogSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('blog-username').value.trim() || 'Anonymous';
    const title = document.getElementById('blog-title').value.trim();
    const content = document.getElementById('blog-content').value.trim();
    const tagsInput = document.getElementById('blog-tags').value;
    const tags = tagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    if (!title || !content) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('blogs').insert({
        user_id: currentUserId,
        username,
        title,
        content,
        tags,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      showToast('Blog submitted successfully!', 'success');
      document.getElementById('blog-form').reset();
      await loadBlogs();
      navigate();
    } catch (error) {
      console.error('Error submitting blog:', error);
      showToast('Failed to submit blog. Please try again.', 'error');
    }
  }

  async function loadBlogs(page = 1, limit = 10) {
    const blogList = document.getElementById('blog-list');
    if (blogList) {
      blogList.innerHTML = `
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    `;
    }
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;
      let query = supabase
        .from('blogs')
        .select(`
        *,
        blog_likes (id, user_id),
        blog_comments (id, username, content, created_at)
      `)
        .order('created_at', { ascending: false })
        .range(start, end);

      if (blogFilter.tag !== 'all') {
        query = query.contains('tags', [blogFilter.tag]);
      }

      const { data: blogs, error } = await query;
      if (error) throw error;

      return blogs.map(blog => ({
        ...blog,
        isLiked: blog.blog_likes ? blog.blog_likes.some(like => like.user_id === currentUserId) : false,
        likeCount: blog.blog_likes ? blog.blog_likes.length : 0,
        commentCount: blog.blog_comments ? blog.blog_comments.length : 0,
        comments: blog.blog_comments ? blog.blog_comments.slice(0, 5) : []
      }));
    } catch (error) {
      console.error('Error loading blogs:', error);
      showToast('Failed to load blogs. Please try again.', 'error');
      return [];
    }
  }

  async function addBlogComment(e, blogId, input) {
    console.log('Submitting comment for blog:', blogId);
    try {
      const content = input.value.trim();
      if (!content) {
        showToast('Comment cannot be empty.', 'error');
        return null;
      }

      const { error } = await supabase.from('blog_comments').insert({
        blog_id: blogId,
        user_id: currentUserId,
        content
      });
      if (error) throw error;

      showToast('Comment added successfully!', 'success');
      input.value = '';
      return true;
    } catch (error) {
      console.error('Error adding blog comment:', error);
      showToast('Failed to add comment. Please try again.', 'error');
      return false;
    }
  }

  async function toggleBlogLike(blogId, likeBtn) {
    try {
      const { data: existingBlogLike, error } = await supabase
        .from('blog_likes')
        .select('id')
        .eq('blog_id', blogId)
        .eq('user_id', currentUserId)
        .single();
      if (error && error.code !== 'PGRST116') throw error; // Ignore "no row" error

      if (existingBlogLike) {
  const { error: deleteError } = await supabase
    .from('blog_likes')
    .delete()
    .eq('id', existingBlogLike.id);
        if (deleteError) throw deleteError;
        return false; // Unliked
      } else {
        const { error: insertError } = await supabase
          .from('blog_likes')
          .from('blog')
          .insert({ blog_id: blogId, user_id: currentUserId });
        if (insertError) throw insertError;
        return true; // Liked
      }
    } catch (error) {
      console.error('Error toggling blog like:', error);
      showToast('Failed to update like. Please try again.', 'error');
      return null;
    }
  }

  async function pollBlogComments(blogId, commentsDiv, commentBtn) {
    try {
      const { data: comments, error } = await supabase
        .from('blog_comments')
        .select('id, username, content, created_at')
        .eq('blog_id', blogId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      if (commentsDiv) {
        const existingCommentIds = Array.from(commentsDiv.children).map(child =>
          child.dataset.commentId || child.querySelector('strong').textContent
        );
        const newComments = comments.filter(comment => !existingCommentIds.includes(comment.id.toString()));
        newComments.forEach(comment => {
          const commentHtml = `
          <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
            <strong>${comment.username}:</strong> ${comment.content}
            <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
          </div>
        `;
          commentsDiv.insertAdjacentHTML('afterbegin', commentHtml);
        });
      }
      if (commentBtn) {
        const { count, error: countError } = await supabase
          .from('blog_comments')
          .select('id', { count: 'exact', head: true })
          .eq('blog_id', blogId);
        if (countError) throw countError;
        commentBtn.innerHTML = `<span class="text-2xl">💬</span> ${count}`;
      }
    } catch (error) {
      console.error('Error polling blog comments:', error);
    }
  }


  async function pollBlogLikes(blogId, likeBtn) {
    try {
      const { data: likes, error } = await supabase
        .from('blog_likes')
        .select('id, user_id')
        .eq('blog_id', blogId);
      if (error) throw error;
      const isLiked = likes.some(like => like.user_id === currentUserId);
      const count = likes.length;
      if (likeBtn) {
        likeBtn.innerHTML = `<span class="text-2xl">${isLiked ? '💖' : '🤍'}</span> ${count}`;
      }
    } catch (error) {
      console.error('Error polling blog likes:', error);
    }
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-lg text-white max-w-sm ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  async function loadBlogDetails(blogId) {
    try {
      const { data: blog, error } = await supabase
        .from('blogs')
        .select(`
        *,
        blog_likes (id, user_id),
        blog_comments (id, username, content, created_at)
      `)
        .eq('id', blogId)
        .single();
      if (error) {
        console.error('Supabase error in loadBlogDetails:', error.message, error.details);
        throw error;
      }
      if (!blog) {
        console.warn('No blog found for ID:', blogId);
        return null;
      }
      return {
        ...blog,
        isLiked: blog.blog_likes ? blog.blog_likes.some(like => like.user_id === currentUserId) : false,
        likeCount: blog.blog_likes ? blog.blog_likes.length : 0,
        commentCount: blog.blog_comments ? blog.blog_comments.length : 0,
        comments: blog.blog_comments ? blog.blog_comments.slice(0, 5) : []
      };
    } catch (error) {
      console.error('Error loading blog details for ID:', blogId, error);
      showToast('Failed to load blog details. Please try again.', 'error');
      return null;
    }
  }

  function subscribeToBlogComments(blogId, callback) {
    // Remove previous subscription if exists
    if (commentSubscriptions[blogId]) {
      supabase.removeChannel(commentSubscriptions[blogId]);
    }

    const subscription = supabase
      .channel(`public:blog_comments:blog_id=eq.${blogId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'blog_comments',
        filter: `blog_id=eq.${blogId}`
      }, payload => {
        callback(payload.new);
      })
      .subscribe(status => {
        console.log('Blog comment subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to blog comments for blog ${blogId}`);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`Blog comment subscription failed for status: ${status}, blogId: ${blogId}, relying on polling`);
        }
      });

    commentSubscriptions[blogId] = subscription;
  }


  function subscribeToBlogLikes(blogId, likeBlogBtn) {
    // Remove previous subscription if needed
    if (likeSubscriptions[blogId]) {
      supabase.removeChannel(likeSubscriptions[blogId]);
    }

    const subscription = supabase
      .channel(`public:blog_likes:blog_id=eq.${blogId}`)
      .on('postgres_changes', {
        event: 'INSERT', // you can also use 'UPDATE' or '*' for all events
        schema: 'public',
        table: 'blog_likes',
        filter: `blog_id=eq.${blogId}`
      }, async (payload) => {
        console.log('New blog like event:', payload);
        await pollBlogLikes(blogId, likeBlogBtn); // update UI
      })
      .subscribe(status => {
        console.log('Blog like subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to blog likes for blog ${blogId}`);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`Blog like subscription failed for blog ${blogId}, falling back to polling`);
        }
      });

    likeSubscriptions[blogId] = subscription;
  }


  function startBlogPolling(blogId, likeBtn, commentsDiv, commentBtn) {
    if (pollingIntervals[blogId]) return;
    pollingIntervals[blogId] = setInterval(() => {
      pollBlogLikes(blogId, likeBtn);
      pollBlogComments(blogId, commentsDiv, commentBtn);
    }, 10000);
    console.log(`Started polling for blog ${blogId}`);
  }

  function stopBlogPolling(blogId) {
    if (pollingIntervals[blogId]) {
      clearInterval(pollingIntervals[blogId]);
      delete pollingIntervals[blogId];
      console.log(`Stopped polling for blog ${blogId}`);
    }
  }

  async function initAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      currentUserId = data.user.id;
    } else {
      currentUserId = session.user.id;
    }
  }

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

  function saveUserState() {
    localStorage.setItem('userState', JSON.stringify(userState));
  }

  function loadFavorites() {
    const savedFavorites = localStorage.getItem('favorites');
    if (savedFavorites) {
      favorites = JSON.parse(savedFavorites);
    }
  }

  function saveFavorites() {
    localStorage.setItem('favorites', JSON.stringify(favorites));
  }

  function loadBlacklisted() {
    const savedBlacklisted = localStorage.getItem('blacklisted');
    if (savedBlacklisted) {
      blacklisted = JSON.parse(savedBlacklisted);
      const now = Date.now();
      blacklisted = blacklisted.filter(item => item.expires > now);
      saveBlacklisted();
    }
  }

  function saveBlacklisted() {
    localStorage.setItem('blacklisted', JSON.stringify(blacklisted));
  }

  function toggleFavorite(mealName) {
    if (favorites.includes(mealName)) {
      favorites = favorites.filter(name => name !== mealName);
    } else {
      favorites.push(mealName);
    }
    saveFavorites();
    navigate();
  }

  function blacklistMeal(mealName) {
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    blacklisted.push({ name: mealName, expires });
    saveBlacklisted();
    navigate();
  }

  async function loadMeals() {
    try {
      const response = await fetch('./public/data/meals.json');
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const jsonMeals = await response.json();
      console.log('JSON meals:', jsonMeals);

      const { data: supabaseMeals, error } = await supabase.from('recipes').select('*');
      if (error) throw error;
      console.log('Supabase meals:', supabaseMeals);

      const supabaseFormattedMeals = supabaseMeals.map(meal => ({
        name: meal.name,
        painLevel: meal.pain_level,
        budget: meal.budget,
        timeToCook: meal.time_to_cook,
        ingredients: meal.ingredients,
        tags: meal.tags,
        steps: meal.steps,
        imageUrl: meal.image_url,
        videoUrl: meal.video_url,
        username: meal.username,
        source: 'supabase',
        id: meal.id,
        created_at: meal.created_at
      }));

      meals = [...jsonMeals, ...supabaseFormattedMeals];
      console.log('All meals:', meals);
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

  function filterMeals() {
    console.log('Filtering meals with userState:', userState);
    const filtered = meals.filter(meal => {
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
      console.log('Meal:', meal.name, { painMatch, budgetMatch, energyMatch, ingredientMatch, notBlacklisted });
      return painMatch && budgetMatch && energyMatch && ingredientMatch && notBlacklisted;
    });
    console.log('Filtered meals:', filtered);
    return filtered;
  }

  function filterAndSortFavorites() {
    let favoriteMeals = meals.filter(meal => favorites.includes(meal.name));

    if (favoriteFilter.painLevel !== 'all') {
      favoriteMeals = favoriteMeals.filter(meal => meal.painLevel === favoriteFilter.painLevel);
    }
    if (favoriteFilter.tag !== 'all') {
      favoriteMeals = favoriteMeals.filter(meal => meal.tags.includes(favoriteFilter.tag));
    }

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

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  async function handleRecipeSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('recipe-name').value.trim();
    const ingredients = document.getElementById('recipe-ingredients').value.split(',').map(i => i.trim());
    const steps = document.getElementById('recipe-steps').value.trim();
    const painLevel = document.getElementById('recipe-pain-level').value;
    const budget = parseInt(document.getElementById('recipe-budget').value);
    const time = parseInt(document.getElementById('recipe-time').value);
    const imageFile = document.getElementById('recipe-image').files[0];
    const videoFile = document.getElementById('recipe-video').files[0];
    const username = document.getElementById('recipe-username').value.trim() || 'Anonymous';

    if (!name || !ingredients.length || !steps || !painLevel || !budget || !time) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    try {
      let imageUrl = null;
      let videoUrl = null;

      if (imageFile) {
        const { data, error } = await supabase.storage
          .from('recipe-images')
          .upload(`${currentUserId}/${Date.now()}_${imageFile.name}`, imageFile);
        if (error) throw error;
        imageUrl = supabase.storage.from('recipe-images').getPublicUrl(data.path).data.publicUrl;
      }

      if (videoFile) {
        const { data, error } = await supabase.storage
          .from('recipe-videos')
          .upload(`${currentUserId}/${Date.now()}_${videoFile.name}`, videoFile);
        if (error) throw error;
        videoUrl = supabase.storage.from('recipe-videos').getPublicUrl(data.path).data.publicUrl;
      }

      const { data: recipe, error } = await supabase.from('recipes').insert({
        user_id: currentUserId,
        username,
        name,
        ingredients,
        steps,
        pain_level: painLevel,
        budget,
        time,
        image: imageUrl,
        video: videoUrl,
        tags: [
          painLevel.toLowerCase() === 'none' ? 'pain-safe' : 'pain-trigger',
          budget < 2000 ? 'low-cost' : 'moderate-cost'
        ]
      }).select().single();
      if (error) throw error;

      showToast('Recipe submitted successfully!', 'success');
      document.getElementById('recipe-form').reset();
      history.pushState({}, '', `/recipe/${recipe.id}`);
      navigate();
    } catch (error) {
      console.error('Error submitting recipe:', error);
      showToast('Failed to submit recipe. Please try again.', 'error');
    }
  }

  async function toggleLike(recipeId, likeBtn) {
    try {
      const { data: existingLike, error } = await supabase
        .from('likes')
        .select('id')
        .eq('recipe_id', recipeId)
        .eq('user_id', currentUserId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;

      if (existingLike) {
        await supabase.from('likes').delete().eq('id', existingLike.id);
        if (likeBtn) {
          likeBtn.querySelector('span').textContent = '🤍';
          const count = parseInt(likeBtn.textContent.trim().split(' ')[1]) - 1;
          likeBtn.textContent = `🤍 ${count}`;
        }
      } else {
        await supabase.from('likes').insert({ recipe_id: recipeId, user_id: currentUserId });
        if (likeBtn) {
          likeBtn.querySelector('span').textContent = '💖';
          const count = parseInt(likeBtn.textContent.trim().split(' ')[1]) + 1;
          likeBtn.textContent = `💖 ${count}`;
        }
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  async function toggleSave(recipeId, saveBtn) {
    try {
      const { data: existingSave, error } = await supabase
        .from('saves')
        .select('id')
        .eq('recipe_id', recipeId)
        .eq('user_id', currentUserId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;

      if (existingSave) {
        await supabase.from('saves').delete().eq('id', existingSave.id);
        if (saveBtn) {
          saveBtn.querySelector('span').textContent = '💿';
          const count = parseInt(saveBtn.textContent.trim().split(' ')[1]) - 1;
          saveBtn.textContent = `💿 ${count}`;
        }
      } else {
        await supabase.from('saves').insert({ recipe_id: recipeId, user_id: currentUserId });
        if (saveBtn) {
          saveBtn.querySelector('span').textContent = '💾';
          const count = parseInt(saveBtn.textContent.trim().split(' ')[1]) + 1;
          saveBtn.textContent = `💾 ${count}`;
        }
      }
    } catch (error) {
      console.error('Error toggling save:', error);
    }
  }

  async function addComment(recipeId, content) {
    try {
      const username = 'Anonymous';
      await supabase.from('comments').insert({
        recipe_id: recipeId,
        user_id: currentUserId,
        username,
        content
      });
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  }

  async function pollLikes(recipeId, likeBtn) {
    try {
      const { data: likes, error } = await supabase
        .from('likes')
        .select('id, user_id')
        .eq('recipe_id', recipeId);
      if (error) throw error;
      const isLiked = likes.some(like => like.user_id === currentUserId);
      const count = likes.length;
      if (likeBtn) {
        likeBtn.innerHTML = `<span class="text-2xl">${isLiked ? '💖' : '🤍'}</span> ${count}`;
      }
    } catch (error) {
      console.error('Error polling likes:', error);
    }
  }

  async function pollComments(recipeId, commentsDiv, commentBtn) {
    try {
      const { data: comments, error } = await supabase
        .from('comments')
        .select('id, username, content, created_at')
        .eq('recipe_id', recipeId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      if (commentsDiv) {
        const existingCommentIds = Array.from(commentsDiv.children).map(child =>
          child.dataset.commentId || child.querySelector('strong').textContent
        );
        const newComments = comments.filter(comment => !existingCommentIds.includes(comment.id));
        newComments.forEach(comment => {
          const commentHtml = `
            <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
              <strong>${comment.username}:</strong> ${comment.content}
              <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
            </div>
          `;
          commentsDiv.insertAdjacentHTML('afterbegin', commentHtml);
        });
      }
      if (commentBtn) {
        const { count } = await supabase
          .from('comments')
          .select('id', { count: 'exact' })
          .eq('recipe_id', recipeId);
        commentBtn.innerHTML = `<span class="text-2xl">💬</span> ${count}`;
      }
    } catch (error) {
      console.error('Error polling comments:', error);
    }
  }

  function timeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  async function loadFeed(page = 1, limit = 10) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      const { data: recipes, error } = await supabase
        .from('recipes')
        .select(`
          *,
          likes (id, user_id),
          saves (id, user_id),
          comments (id, username, content, created_at)
        `)
        .in('pain_level', [userState.painLevel, 'none'])
        .order('created_at', { ascending: false })
        .range(start, end);

      if (error) throw error;

      return recipes.map(recipe => ({
        ...recipe,
        isLiked: recipe.likes.some(like => like.user_id === currentUserId),
        isSaved: recipe.saves.some(save => save.user_id === currentUserId),
        likeCount: recipe.likes.length,
        saveCount: recipe.saves.length,
        commentCount: recipe.comments.length
      }));
    } catch (error) {
      console.error('Error loading feed:', error);
      return [];
    }
  }

  async function loadRecipeDetails(recipeId) {
    try {
      const { data: recipe, error } = await supabase
        .from('recipes')
        .select(`
          *,
          likes (id, user_id),
          saves (id, user_id),
          comments (id, username, content, created_at)
        `)
        .eq('id', recipeId)
        .single();
      if (error) throw error;

      return {
        ...recipe,
        isLiked: recipe.likes.some(like => like.user_id === currentUserId),
        isSaved: recipe.saves.some(save => save.user_id === currentUserId),
        likeCount: recipe.likes.length,
        saveCount: recipe.saves.length,
        commentCount: recipe.comments.length,
        comments: recipe.comments.slice(0, 5)
      };
    } catch (error) {
      console.error('Error loading recipe details:', error);
      return null;
    }
  }

  function subscribeToComments(recipeId, callback) {
    if (commentSubscriptions[recipeId]) {
      supabase.removeChannel(commentSubscriptions[recipeId]);
    }

    const subscription = supabase
      .channel(`public:comments:recipe_id=eq.${recipeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `recipe_id=eq.${recipeId}` }, payload => {
        callback(payload.new);
      })
      .subscribe((status) => {
        console.log('Comment subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to comments for recipe ${recipeId}`);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`Comment subscription failed for recipe ${recipeId}, relying on polling`);
        }
      });

    commentSubscriptions[recipeId] = subscription;
  }

  function subscribeToLikes(recipeId, likeBtn) {
    supabase
      .channel(`public:likes:recipe_id=eq.${recipeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes', filter: `recipe_id=eq.${recipeId}` }, async () => {
        await pollLikes(recipeId, likeBtn);
      })
      .subscribe((status) => {
        console.log('Like subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to likes for recipe ${recipeId}`);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`Like subscription failed for recipe ${recipeId}, relying on polling`);
        }
      });
  }

  function startPolling(recipeId, likeBtn, commentsDiv, commentBtn) {
    if (pollingIntervals[recipeId]) return;
    pollingIntervals[recipeId] = setInterval(() => {
      pollLikes(recipeId, likeBtn);
      pollComments(recipeId, commentsDiv, commentBtn);
    }, 10000);
    console.log(`Started polling for recipe ${recipeId}`);
  }

  function stopPolling(recipeId) {
    if (pollingIntervals[recipeId]) {
      clearInterval(pollingIntervals[recipeId]);
      delete pollingIntervals[recipeId];
      console.log(`Stopped polling for recipe ${recipeId}`);
    }
  }

  initAuth();
  loadUserState();
  loadFavorites();
  loadBlacklisted();
  loadMeals();

  navToggle.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
  });

  filterBtn.addEventListener('click', () => {
    filterModal.classList.remove('hidden');
  });

  mobileFilterBtn.addEventListener('click', () => {
    filterModal.classList.remove('hidden');
  });

  closeFilterBtn.addEventListener('click', () => {
    filterModal.classList.add('hidden');
  });

  budgetSlider.addEventListener('input', () => {
    budgetValue.textContent = `₦${budgetSlider.value}`;
  });

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

  const routes = {
    '/home': () => {
      let filteredMeals = filterMeals();
      if (document.getElementById('shuffle-btn') && document.getElementById('shuffle-btn').dataset.shuffled === 'true') {
        filteredMeals = shuffleArray([...filteredMeals]);
      }
      const mealCards = filteredMeals.length > 0
        ? filteredMeals.map(meal => `
          <div class="bg-white p-4 rounded-t-lg shadow-md cursor-pointer" data-recipe-id="${meal.id || ''}" data-source="${meal.source || 'json'}">
            <img src="${meal.imageUrl || './public/images/placeholder.jpg'}" alt="${meal.name}" class="w-full h-32 object-cover rounded-t-lg">
            <div class="flex justify-between items-center mt-2">
              <h3 class="text-lg font-semibold text-teal-700">${meal.name}</h3>
              <button class="favorite-btn" data-meal-name="${meal.name}" class="text-2xl">
                ${favorites.includes(meal.name) ? '💖' : '🤍'}
              </button>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              ${meal.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
              <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">₦${meal.budget}</span>
              <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${meal.timeToCook} min</span>
            </div>
            <button class="blacklist-btn" data-meal-name="${meal.name}" class="mt-2 w-full bg-gray-200 text-gray-700 p-2 rounded hover:bg-gray-300 text-sm">
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
        <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
          <h1 class="text-2xl font-bold">Meal Suggestions</h1>
          <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
        </header>
        <div class="bg-white p-6 rounded-b-lg shadow-md">
          <div class="flex justify-between items-center mb-4">
            <p class="text-gray-600">Browse personalized meal suggestions based on your filters.</p>
            <button id="shuffle-btn" data-shuffled="false" class="bg-teal-600 text-white p-2 rounded hover:bg-teal-700">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6-4v12m4-4l-4-4m4 4l-4 4"></path>
              </svg>
            </button>
          </div>
          <p class="text-gray-600 mb-4">Current Filters: Pain: ${userState.painLevel}, Budget: ₦${userState.budget}, Energy: ${userState.energyLevel}${userState.ingredients.length > 0 ? `, Ingredients: ${userState.excludeIngredients ? 'exclude ' : ''}${userState.ingredients.join(', ')}` : ''}</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[calc(100vh-300px)] overflow-y-auto">
            ${mealCards}
          </div>
        </div>
      `;
    },
    '/for-you': () => {
      let feedPage = 1;
      let feedLoading = true;
      const skeletonCard = `
        <div class="bg-white p-4 rounded-t-lg shadow-md mb-4 animate-pulse">
          <div class="w-full h-48 bg-gray-200 rounded-t-lg"></div>
          <div class="mt-2 h-6 bg-gray-200 rounded w-3/4"></div>
          <div class="mt-2 h-4 bg-gray-200 rounded w-1/2"></div>
          <div class="flex flex-wrap gap-2 mt-2">
            <div class="h-4 bg-gray-200 rounded w-16"></div>
            <div class="h-4 bg-gray-200 rounded w-16"></div>
          </div>
          <div class="mt-4 flex gap-4">
            <div class="h-6 bg-gray-200 rounded w-12"></div>
            <div class="h-6 bg-gray-200 rounded w-12"></div>
            <div class="h-6 bg-gray-200 rounded w-12"></div>
          </div>
        </div>
      `;
      return `
        <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
          <h1 class="text-2xl font-bold">For You</h1>
          <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
        </header>
        <div class="bg-white p-6 rounded-b-lg shadow-md">
          <p class="text-gray-600 mb-4">Discover new ulcer-safe recipes tailored to your pain level.</p>
          <div id="feed-content" class="space-y-4">
            ${skeletonCard.repeat(3)}
          </div>
          <button id="load-more-btn" class="mt-4 w-full bg-teal-600 text-white p-2 rounded hover:bg-teal-700 hidden">Load More</button>
        </div>
      `;
    },
    '/favorites': () => {
      const favoriteMeals = filterAndSortFavorites();
      const uniqueTags = [...new Set(meals.flatMap(meal => meal.tags))];
      const mealCards = favoriteMeals.length > 0
        ? favoriteMeals.map(meal => `
          <div class="bg-white p-4 rounded-t-lg shadow-md cursor-pointer" data-recipe-id="${meal.id || ''}" data-source="${meal.source || 'json'}">
            <img src="${meal.imageUrl || './public/images/placeholder.jpg'}" alt="${meal.name}" class="w-full h-32 object-cover rounded-t-lg">
            <div class="flex justify-between items-center mt-2">
              <h3 class="text-lg font-semibold text-teal-700">${meal.name}</h3>
              <button class="favorite-btn" data-meal-name="${meal.name}" class="text-2xl">
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
        <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
          <h1 class="text-2xl font-bold">Favorites</h1>
          <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
        </header>
        <div class="bg-white p-6 rounded-b-lg shadow-md">
          <p class="text-gray-600 mb-4">Your favorite ulcer-safe meals.</p>
          <div class="flex flex-wrap gap-4 mb-4">
            <div>
              <label for="sort-favorites" class="block text-sm font-medium text-gray-700">Sort by</label>
              <select id="sort-favorites" class="mt-1 block p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
                <option value="name" ${favoriteSort === 'name' ? 'selected' : ''}>Name</option>
                <option value="budget" ${favoriteSort === 'budget' ? 'selected' : ''}>Budget</option>
                <option value="time" ${favoriteSort === 'time' ? 'selected' : ''}>Time to Cook</option>
              </select>
            </div>
            <div>
              <label for="filter-pain-level" class="block text-sm font-medium text-gray-700">Pain Level</label>
              <select id="filter-pain-level" class="mt-1 block p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
                <option value="all" ${favoriteFilter.painLevel === 'all' ? 'selected' : ''}>All</option>
                <option value="none" ${favoriteFilter.painLevel === 'none' ? 'selected' : ''}>None</option>
                <option value="mild" ${favoriteFilter.painLevel === 'mild' ? 'selected' : ''}>Mild</option>
                <option value="active" ${favoriteFilter.painLevel === 'active' ? 'selected' : ''}>Active</option>
              </select>
            </div>
            <div>
              <label for="filter-tags" class="block text-sm font-medium text-gray-700">Tag</label>
              <select id="filter-tags" class="mt-1 block p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
                <option value="all" ${favoriteFilter.tag === 'all' ? 'selected' : ''}>All</option>
                ${uniqueTags.map(tag => `<option value="${tag}" ${favoriteFilter.tag === tag ? 'selected' : ''}>${tag}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[calc(100vh-400px)] overflow-y-auto">
            ${mealCards}
          </div>
        </div>
      `;
    },
    '/add-meal': () => `
      <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
        <h1 class="text-2xl font-bold">Add a Meal</h1>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </header>
      <div class="bg-white p-6 rounded-b-lg shadow-md">
        <p class="text-gray-600 mb-4">Share your ulcer-safe recipe with the community.</p>
        <form id="recipe-form" class="space-y-4">
          <div>
            <label for="meal-username" class="block text-sm font-medium text-gray-700">Username (optional)</label>
            <input type="text" id="meal-username" class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., Foodie123">
          </div>
          <div>
            <label for="meal-name" class="block text-sm font-medium text-gray-700">Meal Name</label>
            <input type="text" id="meal-name" required
              class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" 
              placeholder="e.g., Creamy Oatmeal">
          </div>
          <div>
            <label for="meal-ingredients" class="block text-sm font-medium text-gray-700">Ingredients (comma-separated)</label>
            <input type="text" id="meal-ingredients" required
                   class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" 
                   placeholder="e.g., oats, milk, banana">
          </div>
          <div>
            <label for="meal-steps" class="block text-sm font-medium text-gray-700">Steps</label>
            <textarea id="meal-steps" required
                   class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" 
                   rows="4" 
                   placeholder="e.g., Boil water, add oats..."></textarea>
          </div>
          <div>
            <label for="meal-pain-level" class="block text-sm font-medium text-gray-700">Pain Level</label>
            <select id="meal-pain-level" 
                    class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
              <option value="none">None</option>
              <option value="mild">Mild</option>
              <option value="active">Active</option>
            </select>
          </div>
          <div>
            <label for="meal-budget" class="block text-sm font-medium text-gray-700">Price (₦)</label>
            <select id="meal-budget" 
                    class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
              <option value="500">₦500</option>
              <option value="1000">₦1000</option>
              <option value="1500">₦1500</option>
              <option value="2000">₦2000</option>
              <option value="2500">₦2500</option>
            </select>
          </div>
          <div>
            <label for="meal-time" class="block text-sm font-medium text-gray-700">Time to Cook (minutes)</label>
            <select id="meal-time" 
                    class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="15">15 min</option>
              <option value="20">20 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
            </select>
          </div>
          <div>
            <label for="meal-image" class="block text-sm font-medium text-gray-700">Image (optional)</label>
            <input type="file" id="meal-image" accept="image/*" 
                   class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg">
          </div>
          <div>
            <label for="meal-video" class="block text-sm font-medium text-gray-700">Video (optional)</label>
            <input type="file" id="meal-video" accept="video/*" 
                   class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg">
          </div>
          <button type="submit" class="w-full bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Submit Recipe</button>
        </form>
      </div>
    `,
    '/my-log': () => `
      <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
        <h1 class="text-2xl font-bold">My Log</h1>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </header>
      <div class="bg-white p-6 rounded-b-lg shadow-md">
        <p class="text-gray-600">Track what you ate and how it affected your stomach.</p>
        <div class="mt-4">
          <div class="bg-gray-100 p-4 rounded-t-lg">Log Entry 1</div>
          <div class="bg-gray-100 p-4 rounded-t-lg mt-2">Log Entry 2</div>
        </div>
      </div>
    `,
    '/relief-hub': () => `
      <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
        <h1 class="text-2xl font-bold">Relief Hub</h1>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </header>
      <div class="bg-white p-6 rounded-b-lg shadow-md">
        <p class="text-gray-600">Find quick relief tips, soothing teas, and emergency meals.</p>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-gray-100 p-4 rounded-t-lg">Relief Tip 1</div>
          <div class="bg-gray-100 p-4 rounded-t-lg">Relief Tip 2</div>
        </div>
      </div>
    `,
    '/blogs': () => {
      const uniqueTags = ['Trigger', 'Comfort', 'Budget Hack'];
      return `
    <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
      <h1 class="text-2xl font-bold">Blogs</h1>
      <div class="flex gap-2">
        <button id="toggle-blog-form" class="text-teal-200 hover:text-white text-2xl">➕</button>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </div>
    </header>
    <div class="bg-white p-6 rounded-b-lg shadow-md">
      <p class="text-gray-600 mb-4">Share and read community stories and experiences.</p>
      <form id="blog-form" class="space-y-4 mb-6 hidden">
        <div>
          <label for="blog-username" class="block text-sm font-medium text-gray-700">Username (optional)</label>
          <input type="text" id="blog-username" class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., Foodie123">
        </div>
        <div>
          <label for="blog-title" class="block text-sm font-medium text-gray-700">Title</label>
          <input type="text" id="blog-title" required class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., My Ulcer Journey">
        </div>
        <div>
          <label for="blog-content" class="block text-sm font-medium text-gray-700">Content</label>
          <textarea id="blog-content" required class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" rows="6" placeholder="Share your story..."></textarea>
        </div>
        <div>
          <label for="blog-tags" class="block text-sm font-medium text-gray-700">Tags (comma-separated, e.g., Trigger, Comfort)</label>
          <input type="text" id="blog-tags" class="mt-1 block w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" placeholder="e.g., Trigger, Comfort, Budget Hack">
        </div>
        <button type="submit" class="w-full bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Submit Blog</button>
      </form>
      <div class="flex mb-4">
        <div>
          <label for="filter-blog-tags" class="block text-sm font-medium text-gray-700">Filter by Tag</label>
          <select id="filter-blog-tags" class="mt-1 block p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
            <option value="all" ${blogFilter.tag === 'all' ? 'selected' : ''}>All</option>
            ${uniqueTags.map(tag => `<option value="${tag}" ${blogFilter.tag === tag ? 'selected' : ''}>${tag}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="blog-list" class="space-y-4">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
      <button id="load-more-blogs" class="mt-4 w-full bg-teal-600 text-white p-2 rounded hover:bg-teal-700 hidden">Load More</button>
    </div>
  `;
    },

    '/blog/:id': async (id) => {
      const blog = await loadBlogDetails(id);
      if (!blog) {
        return `
      <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
        <h1 class="text-2xl font-bold">Blog Not Found</h1>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </header>
      <div class="bg-white p-6 rounded-b-lg shadow-md">
        <p class="text-center text-gray-600">Sorry, this blog could not be found! 💔</p>
      </div>
    `;
      }

      return `
    <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
      <h1 class="text-2xl font-bold">${blog.title}</h1>
      <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
    </header>
    <div class="bg-white p-6 rounded-b-lg shadow-md">
      <div class="mb-4">
        <p class="text-sm text-gray-600">by ${blog.username}</p>
        <p class="text-xs text-gray-500">${timeAgo(blog.created_at)}</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        ${blog.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
      </div>
      <div class="mb-4">
        <p class="text-gray-600">${blog.content.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="mt-4 flex gap-4 mb-4">
        <button class="blog-like-btn" data-blog-id="${blog.id}">
          <span class="text-2xl">${blog.isLiked ? '💖' : '🤍'}</span> ${blog.likeCount}
        </button>
        <button class="blog-comment-btn" data-blog-id="${blog.id}">
          <span class="text-2xl">💬</span> ${blog.commentCount}
        </button>
      </div>
      <div class="mb-4">
        <h2 class="text-lg font-semibold text-teal-700">Comments</h2>
        <form class="blog-comment-form" data-blog-id="${blog.id}">
          <input type="text" placeholder="Add a comment..." class="w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" required>
          <button type="submit" class="mt-2 bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Post</button>
        </form>
        <div id="blog-comments-${blog.id}" class="comments mt-2 max-h-48 overflow-y-auto">
          ${blog.comments.map(comment => `
            <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
              <strong>${comment.username}:</strong> ${comment.content}
              <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
            </div>
          `).join('')}
        </div>
        ${blog.commentCount > 5 ? `
          <button class="load-more-blog-comments" data-blog-id="${blog.id}" data-offset="5" class="mt-2 text-teal-600 hover:text-teal-700 text-sm">Load More Comments</button>
        ` : ''}
      </div>
    </div>
  `;
    },

    '/settings': () => `
      <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
        <h1 class="text-2xl font-bold">Settings</h1>
        <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
      </header>
      <div class="bg-white p-6 rounded-b-lg shadow-md">
        <p class="text-gray-600">Customize your app experience.</p>
        <div class="mt-4">
          <div class="bg-gray-100 p-4 rounded-t-lg">Settings Option 1</div>
          <div class="bg-gray-100 p-4 rounded-t-lg mt-2">Settings Option 2</div>
        </div>
      </div>
    `,
    '/recipe/:id': async (id) => {
      const recipe = await loadRecipeDetails(id);
      if (!recipe) {
        return `
          <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
            <h1 class="text-2xl font-bold">Recipe Not Found</h1>
            <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
          </header>
          <div class="bg-white p-6 rounded-b-lg shadow-md">
            <p class="text-center text-gray-600">Sorry, this recipe could not be found! 💔</p>
          </div>
        `;
      }

      return `
        <header class="bg-teal-700 text-white p-4 rounded-t-lg flex justify-between items-center">
          <h1 class="text-2xl font-bold">${recipe.name}</h1>
          <button onclick="history.back()" class="text-teal-200 hover:text-white text-sm">Back</button>
        </header>
        <div class="bg-white p-6 rounded-b-lg shadow-md">
          ${recipe.video_url ? `
            <video controls class="w-full h-64 object-cover rounded-t-lg mb-4">
              <source src="${recipe.video_url}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          ` : `
            <img src="${recipe.image_url || './public/images/placeholder.jpg'}" alt="${recipe.name}" class="w-full h-64 object-cover rounded-t-lg mb-4">
          `}
          <div class="mb-4">
            <p class="text-sm text-gray-600">by ${recipe.username}</p>
            <p class="text-xs text-gray-500">${timeAgo(recipe.created_at)}</p>
          </div>
          <div class="flex flex-wrap gap-2 mb-4">
            ${recipe.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
            <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">₦${recipe.budget}</span>
            <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${recipe.time_to_cook} min</span>
            <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${recipe.pain_level}</span>
          </div>
          <div class="mt-4 flex gap-4 mb-4">
            <button class="like-btn" data-recipe-id="${recipe.id}">
              <span class="text-2xl">${recipe.isLiked ? '💖' : '🤍'}</span> ${recipe.likeCount}
            </button>
            <button class="save-btn" data-recipe-id="${recipe.id}">
              <span class="text-2xl">${recipe.isSaved ? '💾' : '💿'}</span> ${recipe.saveCount}
            </button>
            <button class="comment-btn" data-recipe-id="${recipe.id}">
              <span class="text-2xl">💬</span> ${recipe.commentCount}
            </button>
          </div>
          <div class="mb-4">
            <h2 class="text-lg font-semibold text-teal-700">Ingredients</h2>
            <ul class="list-disc pl-5">
              ${recipe.ingredients.map(ing => `<li class="text-gray-600">${ing}</li>`).join('')}
            </ul>
          </div>
          <div class="mb-4">
            <h2 class="text-lg font-semibold text-teal-700">Steps</h2>
            <p class="text-gray-600">${recipe.steps.replace(/\n/g, '<br>')}</p>
          </div>
          <div class="mb-4">
            <h2 class="text-lg font-semibold text-teal-700">Comments</h2>
            <form class="comment-form" data-recipe-id="${recipe.id}">
              <input type="text" placeholder="Add a comment..." class="w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" required>
              <button type="submit" class="mt-2 bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Post</button>
            </form>
            <div id="comments-${recipe.id}" class="comments mt-2 max-h-48 overflow-y-auto">
              ${recipe.comments.map(comment => `
                <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
                  <strong>${comment.username}:</strong> ${comment.content}
                  <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
                </div>
              `).join('')}
            </div>
            ${recipe.commentCount > 5 ? `
              <button class="load-more-comments" data-recipe-id="${recipe.id}" data-offset="5" class="mt-2 text-teal-600 hover:text-teal-700 text-sm">Load More Comments</button>
            ` : ''}
          </div>
        </div>
      `;
    }
  };

  const defaultRoute = '/home';

  function navigate() {
    let path = window.location.pathname || defaultRoute;
    let routeHandler = null;
    let params = null;

    console.log('Navigating to path:', path); // Debug log

    const recipeMatch = path.match(/^\/recipe\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    const blogMatch = path.match(/^\/blog\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (recipeMatch) {
      path = '/recipe/:id';
      params = recipeMatch[1];
      console.log('Matched recipe route with ID:', params);
    } else if (blogMatch) {
      path = '/blog/:id';
      params = blogMatch[1];
      console.log('Matched blog route with ID:', params);
    } else {
      console.log('No specific route matched, using path:', path);
    }

    routeHandler = routes[path] || routes[defaultRoute];
    const contentDiv = document.getElementById('content');
    if (params) {
      console.log('Calling route handler with params:', params);
      routeHandler(params).then(html => {
        console.log('Rendering HTML for route:', path);
        contentDiv.innerHTML = html;
        attachEventListeners();
      }).catch(err => {
        console.error('Error rendering route:', path, err);
        contentDiv.innerHTML = `<p>Error loading page. Please try again.</p>`;
      });
    } else {
      console.log('Rendering static route:', path);
      contentDiv.innerHTML = routeHandler();
      attachEventListeners();
    }
  }

  function attachEventListeners() {
    const shuffleBtn = document.getElementById('shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        shuffleBtn.dataset.shuffled = 'true';
        navigate();
        setTimeout(() => { shuffleBtn.dataset.shuffled = 'false'; }, 0);
      });
    }

    const toggleBlogFormBtn = document.getElementById('toggle-blog-form');
    if (toggleBlogFormBtn) {
      toggleBlogFormBtn.addEventListener('click', () => {
        const blogForm = document.getElementById('blog-form');
        blogForm.classList.toggle('hidden');
        toggleBlogFormBtn.textContent = blogForm.classList.contains('hidden') ? '➕' : '➖';
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

    const filterTags = document.getElementById('filter-tags');
    if (filterTags) {
      filterTags.addEventListener('change', (e) => {
        favoriteFilter.tag = e.target.value;
        navigate();
      });
    }

    document.querySelectorAll('.favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mealName = btn.dataset.mealName;
        toggleFavorite(mealName);
      });
    });

    document.querySelectorAll('.blacklist-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mealName = btn.dataset.mealName;
        blacklistMeal(mealName);
      });
    });

    document.querySelectorAll('[data-recipe-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.favorite-btn') || e.target.closest('.blacklist-btn')) return;
        const recipeId = card.dataset.recipeId;
        const source = card.dataset.source;
        if (source === 'supabase' && recipeId) {
          history.pushState({}, '', `/recipe/${recipeId}`);
          navigate();
        }
      });
    });

    if (window.location.pathname === '/for-you') {
      let feedPage = 1;
      const feedContent = document.getElementById('feed-content');
      const loadMoreBtn = document.getElementById('load-more-btn');

      async function renderFeed() {
        const recipes = await loadFeed(feedPage);
        if (recipes.length > 0) {
          const cards = recipes.map(recipe => `
            <div class="bg-white p-4 rounded-t-lg shadow-md mb-4 cursor-pointer" data-recipe-id="${recipe.id}" data-source="supabase">
              ${recipe.video_url ? `
                <video controls class="w-full h-48 object-cover rounded-t-lg">
                  <source src="${recipe.video_url}" type="video/mp4">
                  Your browser does not support the video tag.
                </video>
              ` : `
                <img src="${recipe.image_url || './public/images/placeholder.jpg'}" alt="${recipe.name}" class="w-full h-48 object-cover rounded-t-lg">
              `}
              <div class="mt-2">
                <h3 class="text-lg font-semibold text-teal-700">${recipe.name}</h3>
                <p class="text-sm text-gray-600">by ${recipe.username}</p>
                <p class="text-xs text-gray-500">${timeAgo(recipe.created_at)}</p>
              </div>
              <div class="flex flex-wrap gap-2 mt-2">
                ${recipe.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
                <span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">₦${recipe.budget}</span>
              </div>
              <div class="mt-4 flex gap-2">
                <button class="like-btn" data-recipe-id="${recipe.id}">
                  <span class="text-2xl">${recipe.isLiked ? '💖' : '🤍'}</span> ${recipe.likeCount}
                </button>
                <button class="save-btn" data-recipe-id="${recipe.id}">
                  <span class="text-2xl">${recipe.isSaved ? '💾' : '💿'}</span> ${recipe.saveCount}
                </button>
                <button class="comment-btn" data-recipe-id="${recipe.id}">
                  <span class="text-2xl">💬</span> ${recipe.commentCount}
                </button>
              </div>
              <div class="mt-2">
                <form class="comment-form" data-feed-comment="${recipe.id}">
                  <input type="text" placeholder="Add a comment..." class="w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500">
                  <button type="submit" class="mt-2 bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Post</button>
                </form>
                <div class="comments mt-2 max-h-32 overflow-y-auto">
                  ${recipe.comments.slice(0, 5).map(comment => `
                    <div class="text-sm text-gray-600 mb-1">
                      <strong>${comment.username}:</strong> ${comment.content}
                      <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          `).join('');
          feedContent.innerHTML = cards;
          loadMoreBtn.classList.remove('hidden');

          recipes.forEach(recipe => {
            const likeBtn = feedContent.querySelector(`.like-btn[data-recipe-id="${recipe.id}"]`);
            if (likeBtn) subscribeToLikes(recipe.id, likeBtn);
          });
        } else {
          feedContent.innerHTML += `<p class="text-center text-gray-600">No more recipes to show.</p>`;
          loadMoreBtn.classList.add('hidden');
        }
      }

      renderFeed();

      loadMoreBtn.addEventListener('click', () => {
        feedPage++;
        renderFeed();
      });

      feedContent.addEventListener('click', e => {
        const likeBtn = e.target.closest('.like-btn');
        const saveBtn = e.target.closest('.save-btn');
        const commentBtn = e.target.closest('.comment-btn');
        if (likeBtn) {
          e.stopPropagation();
          toggleLike(likeBtn.dataset.recipeId, likeBtn);
        } else if (saveBtn) {
          e.stopPropagation();
          toggleSave(saveBtn.dataset.recipeId, saveBtn);
        } else if (commentBtn) {
          e.stopPropagation();
          const form = commentBtn.nextElementSibling.querySelector('input');
          if (form) form.focus();
        }
      });

      feedContent.addEventListener('submit', e => {
        e.preventDefault();
        e.stopPropagation();
        const form = e.target.closest('.comment-form');
        if (form) {
          const input = form.querySelector('input');
          const content = input.value.trim();
          if (content) {
            addComment(form.dataset.feedComment, content);
            input.value = '';
          }
        }
      });
    }

    if (window.location.pathname.match(/^\/recipe\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const recipeId = window.location.pathname.split('/recipe/')[1];
      const contentDiv = document.getElementById('content');

      const likeBtn = contentDiv.querySelector('.like-btn');
      const saveBtn = contentDiv.querySelector('.save-btn');
      const commentBtn = contentDiv.querySelector('.comment-btn');
      const commentForm = contentDiv.querySelector('.comment-form');
      const commentsDiv = contentDiv.querySelector(`#comments-${recipeId}`);
      const loadMoreComments = contentDiv.querySelector('.load-more-comments');

      if (likeBtn) {
        likeBtn.addEventListener('click', () => toggleLike(recipeId, likeBtn));
        subscribeToLikes(recipeId, likeBtn);
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', () => toggleSave(recipeId, saveBtn));
      }

      if (commentBtn) {
        commentBtn.addEventListener('click', () => {
          const input = commentForm.querySelector('input');
          if (input) input.focus();
        });
      }

      if (commentForm) {
        commentForm.addEventListener('submit', e => {
          e.preventDefault();
          const input = commentForm.querySelector('input');
          const content = input.value.trim();
          if (content) {
            addBlogComment(e, blogId, input); // Pass event, blogId, and input
            input.value = '';
          }
        });
      }

      if (commentsDiv && commentBtn) {
        subscribeToComments(recipeId, (newComment) => {
          const commentHtml = `
            <div class="text-sm text-gray-600 mb-1" data-comment-id="${newComment.id}">
              <strong>${newComment.username}:</strong> ${newComment.content}
              <span class="text-xs text-gray-500">${timeAgo(newComment.created_at)}</span>
            </div>
          `;
          commentsDiv.insertAdjacentHTML('afterbegin', commentHtml);
          const count = parseInt(commentBtn.textContent.trim().split(' ')[1]) + 1;
          commentBtn.innerHTML = `<span class="text-2xl">💬</span> ${count}`;
        });
        startPolling(recipeId, likeBtn, commentsDiv, commentBtn);
      }

      if (loadMoreComments) {
        loadMoreComments.addEventListener('click', async () => {
          const offset = parseInt(loadMoreComments.dataset.offset);
          const limit = 5;
          const { data: moreComments, error } = await supabase
            .from('comments')
            .select('id, username, content, created_at')
            .eq('recipe_id', recipeId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) {
            console.error('Error loading more comments:', error);
            return;
          }
          if (commentsDiv && moreComments.length > 0) {
            moreComments.forEach(comment => {
              const commentHtml = `
                <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
                  <strong>${comment.username}:</strong> ${comment.content}
                  <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
                </div>
              `;
              commentsDiv.insertAdjacentHTML('beforeend', commentHtml);
            });
            loadMoreComments.dataset.offset = (offset + moreComments.length).toString();
            if (moreComments.length < limit) {
              loadMoreComments.remove();
            }
          } else {
            loadMoreComments.remove();
          }
        });
      }

      window.addEventListener('popstate', () => {
        stopPolling(recipeId);
      }, { once: true });
    }

    const blogForm = document.getElementById('blog-form');
    if (blogForm) {
      blogForm.addEventListener('submit', handleBlogSubmit);
    }

    const filterBlogTags = document.getElementById('filter-blog-tags');
    if (filterBlogTags) {
      filterBlogTags.addEventListener('change', (e) => {
        blogFilter.tag = e.target.value;
        navigate();
      });
    }

    const blogList = document.getElementById('blog-list');
    if (blogList) {
      let blogPage = 1;
      async function renderBlogs() {
        const blogs = await loadBlogs(blogPage);
        if (blogs.length > 0) {
          blogList.innerHTML = blogs.map(blog => `
      <div class="bg-white p-4 rounded-t-lg shadow-md cursor-pointer" data-blog-id="${blog.id}">
        <h3 class="text-lg font-semibold text-teal-700">${blog.title}</h3>
        <p class="text-sm text-gray-600">by ${blog.username}</p>
        <p class="text-xs text-gray-500">${timeAgo(blog.created_at)}</p>
        <p class="text-gray-600 mt-2 line-clamp-3">${blog.content}</p>
        <div class="flex flex-wrap gap-2 mt-2">
          ${blog.tags.map(tag => `<span class="bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded">${tag}</span>`).join('')}
        </div>
        <div class="mt-4 flex gap-2">
          <button class="blog-like-btn" data-blog-id="${blog.id}">
            <span class="text-2xl">${blog.isLiked ? '💖' : '🤍'}</span> ${blog.likeCount}
          </button>
          <button class="blog-comment-btn" data-blog-id="${blog.id}">
            <span class="text-2xl">💬</span> ${blog.commentCount}
          </button>
        </div>
        <div class="mt-2">
          <form class="blog-comment-form" data-blog-id="${blog.id}">
            <input type="text" placeholder="Add a comment..." class="w-full p-2 border border-gray-300 rounded-t-lg focus:ring-teal-500 focus:border-teal-500" required>
            <button type="submit" class="mt-2 bg-teal-600 text-white p-2 rounded-t-lg hover:bg-teal-700">Post</button>
          </form>
          <div class="comments mt-2 max-h-32 overflow-y-auto">
            ${blog.comments.map(comment => `
              <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
                <strong>${comment.username}:</strong> ${comment.content}
                <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
          document.getElementById('load-more-blogs').classList.remove('hidden');
        } else {
          blogList.innerHTML = `<p class="text-center text-gray-600">No blogs available.</p>`;
          document.getElementById('load-more-blogs').classList.add('hidden');
        }
      }
      renderBlogs();
      document.getElementById('load-more-blogs').addEventListener('click', () => {
        blogPage++;
        renderBlogs();
      });
      blogList.querySelectorAll('[data-blog-id]').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-blog-id');
          history.pushState({}, '', `/blog/${id}`);
          navigate(); // trigger re-render
        });
      });

    }

    document.querySelectorAll('.blog-comment-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const blogId = form.dataset.blogId;
        const input = form.querySelector('input');
        const success = await addBlogComment(e, blogId, input);
        if (success) {
          // Re-render blogs to show new comment
          renderBlogs();
        }
      });
    });

    document.querySelectorAll('[data-blog-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.blog-like-btn') || e.target.closest('.blog-comment-btn')) return;
        const blogId = card.dataset.blogId;
        console.log('Navigating to blog:', blogId); // Debug log
        history.pushState({}, '', `/blog/${blogId}`);
        navigate();
      });
    });

    document.querySelectorAll('.blog-like-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBlogLike(btn.dataset.blogId, btn);
      });
    });

    document.querySelectorAll('.blog-comment-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const blogId = btn.dataset.blogId;
        history.pushState({}, '', `/blog/${blogId}`);
        navigate();
        // Defer focusing until the new page is rendered
        setTimeout(() => {
          const form = document.querySelector(`.blog-comment-form[data-blog-id="${blogId}"]`);
          if (form) {
            const input = form.querySelector('input');
            if (input) input.focus();
          }
        }, 0);
      });
    });

    if (window.location.pathname.match(/^\/blog\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const blogId = window.location.pathname.split('/blog/')[1];
      const contentDiv = document.getElementById('content');

      const likeBtn = contentDiv.querySelector('.blog-like-btn');
      const commentBtn = contentDiv.querySelector('.blog-comment-btn');
      const commentForm = contentDiv.querySelector('.blog-comment-form');
      const commentsDiv = contentDiv.querySelector(`#blog-comments-${blogId}`);
      const loadMoreComments = contentDiv.querySelector('.load-more-blog-comments');

      if (likeBtn) {
        likeBtn.addEventListener('click', () => toggleBlogLike(blogId, likeBtn));
        subscribeToBlogLikes(blogId, likeBtn);
      }

      if (commentBtn) {
        commentBtn.addEventListener('click', () => {
          const input = commentForm.querySelector('input');
          if (input) input.focus();
        });
      }

      if (commentForm) {
        commentForm.addEventListener('submit', e => {
          e.preventDefault();
          const input = commentForm.querySelector('input');
          const content = input.value.trim();
          if (content) {
            addBlogComment(blogId, content);
            input.value = '';
          }
        });
      }

      if (commentsDiv && commentBtn) {
        subscribeToBlogComments(blogId, (newComment) => {
          const commentHtml = `
          <div class="text-sm text-gray-600 mb-1" data-comment-id="${newComment.id}">
            <strong>${newComment.username}:</strong> ${newComment.content}
            <span class="text-xs text-gray-500">${timeAgo(newComment.created_at)}</span>
          </div>
        `;
          commentsDiv.insertAdjacentHTML('afterbegin', commentHtml);
          const count = parseInt(commentBtn.textContent.trim().split(' ')[1]) + 1;
          commentBtn.innerHTML = `<span class="text-2xl">💬</span> ${count}`;
        });
        startBlogPolling(blogId, likeBtn, commentsDiv, commentBtn);
      }

      if (loadMoreComments) {
        loadMoreComments.addEventListener('click', async () => {
          const offset = parseInt(loadMoreComments.dataset.offset);
          const limit = 5;
          const { data: moreComments, error } = await supabase
            .from('blog_comments')
            .select('id, username, content, created_at')
            .eq('blog_id', blogId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) {
            console.error('Error loading more blog comments:', error);
            showToast('Failed to load more comments.', 'error');
            return;
          }
          if (commentsDiv && moreComments.length > 0) {
            moreComments.forEach(comment => {
              const commentHtml = `
              <div class="text-sm text-gray-600 mb-1" data-comment-id="${comment.id}">
                <strong>${comment.username}:</strong> ${comment.content}
                <span class="text-xs text-gray-500">${timeAgo(comment.created_at)}</span>
              </div>
            `;
              commentsDiv.insertAdjacentHTML('beforeend', commentHtml);
            });
            loadMoreComments.dataset.offset = (offset + moreComments.length).toString();
            if (moreComments.length < limit) {
              loadMoreComments.remove();
            }
          } else {
            loadMoreComments.remove();
          }
        });
      }

      window.addEventListener('popstate', () => {
        stopBlogPolling(blogId);
      }, { once: true });
    }
  }

  window.addEventListener('popstate', navigate);

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href.startsWith(window.location.origin)) {
      e.preventDefault();
      const path = new URL(link.href).pathname;
      history.pushState({}, '', path);
      navigate();
    }
  });

  navigate();
});