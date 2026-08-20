/* ============================================================
   XiaoNaiPing · 暖色奶瓶风音乐播放器
   内置 GD 音乐 API（netease），支持搜索 / 播放更多歌曲
   功能：播放/暂停、上一首/下一首、随机、单曲循环、
        进度拖动、播放列表、歌曲搜索、侧边缩放开关
   ============================================================ */
(function($) {
	'use strict';

	/* ---------- 配置 ---------- */
	var API = 'https://music-api.gdstudio.xyz/api.php';
	var SOURCE = 'netease';
	var DEFAULT_COVER = 'http://p1.music.126.net/axTRReTzIQQyibyKwXfLaw==/109951163785304009.jpg?param=300y300';
	var DEFAULT_KEYWORDS = ['热歌', '周杰伦', '轻音乐', '纯音乐']; // 默认歌单搜索词

	/* ---------- 状态 ---------- */
	var playlist = [];          // 当前播放列表
	var currentTrack = 0;       // 当前曲目索引
	var isPlaying = false;      // 是否播放中
	var isShuffle = false;      // 随机播放
	var isLoop = false;         // 单曲循环
	var audio = null;           // Audio 对象
	var urlCache = {};          // id -> 播放地址
	var picCache = {};          // id -> 封面地址
	var shuffleOrder = [];      // 随机顺序
	var shuffleIndex = 0;
	var isSeeking = false;

	/* ---------- 本地默认歌曲（保证离线也能播放） ---------- */
	var localSong = {
		id: 'local',
		title: '轻音乐',
		artist: '本地音乐',
		mp3: './轻音乐.m4a',
		cover: DEFAULT_COVER
	};

	/* ---------- 工具函数 ---------- */
	function fmtTime(sec) {
		if (!isFinite(sec) || sec < 0) sec = 0;
		var m = Math.floor(sec / 60);
		var s = Math.floor(sec % 60);
		return m + ':' + (s < 10 ? '0' + s : s);
	}

	function showNotification(msg) {
		$('.qplayer-notification').remove();
		var $n = $('<div class="qplayer-notification"><span class="qplayer-notification-icon">♪</span><span class="message"></span><a class="close" href="javascript:void(0)">×</a></div>');
		$n.find('.message').text(msg);
		$('body').append($n);
		setTimeout(function() { $n.fadeOut(400, function() { $n.remove(); }); }, 2600);
	}

	function apiGet(params, retries) {
		retries = retries || 1;
		return $.ajax({
			url: API,
			data: params,
			dataType: 'json',
			timeout: 20000
		}).fail(function(xhr) {
			// 网络/超时错误（status 0）时自动重试一次
			if (retries > 0 && xhr.status === 0) {
				return apiGet(params, retries - 1);
			}
		});
	}

	/* ---------- 播放器渲染 ---------- */
	function renderPlaylist() {
		var $list = $('#plList');
		$list.empty();
		playlist.forEach(function(song, i) {
			var $li = $('<li></li>');
			if (i === currentTrack) $li.addClass('playing');
			$li.append('<span class="pl-num">' + (i + 1) + '</span>');
			$li.append(
				'<span class="pl-info"><span class="pl-name"></span><span class="pl-artist"></span></span>' +
				'<span class="pl-eq"><span></span><span></span><span></span></span>'
			);
			$li.find('.pl-name').text(song.title);
			$li.find('.pl-artist').text(song.artist || '未知歌手');
			$li.on('click', function() { playTrack(i); });
			$list.append($li);
		});
		$('#plCount').text(playlist.length + ' 首');
	}

	function renderNowPlaying() {
		var song = playlist[currentTrack] || localSong;
		$('.musicTag strong').text(song.title);
		$('.musicTag .artist').text(song.artist || '未知歌手');
		$('.musicTag .artist').prev('span').text(' - ');
		// 封面
		var $cover = $('#player .cover');
		$cover.find('img').remove();
		if (song.cover) {
			$('<img>').attr('src', song.cover).attr('alt', song.title).on('error', function() {
				$(this).attr('src', DEFAULT_COVER);
			}).appendTo($cover);
		} else {
			$('<img>').attr('src', DEFAULT_COVER).attr('alt', song.title).appendTo($cover);
		}
		// 歌单高亮
		$('#plList li').removeClass('playing').eq(currentTrack).addClass('playing');
		// 进度归零
		$('.progress .fill').css('width', '0%');
		$('.timer.left').text('0:00');
		$('.timer.right').text(song.duration ? fmtTime(song.duration) : '0:00');
	}

	/* ---------- 音频控制 ---------- */
	function play() {
		if (!audio) return;
		audio.play().then(function() {
			isPlaying = true;
			$('.btn-play .ic-play').hide();
			$('.btn-play .ic-pause').show();
			$('#player .cover').addClass('rotating');
		}).catch(function() {
			isPlaying = false;
			showNotification('播放失败，请重试');
		});
	}

	function pause() {
		if (!audio) return;
		audio.pause();
		isPlaying = false;
		$('.btn-play .ic-play').show();
		$('.btn-play .ic-pause').hide();
		$('#player .cover').removeClass('rotating');
	}

	function togglePlay() {
		if (isPlaying) { pause(); } else { play(); }
	}

	function loadTrack(index, autoPlay) {
		if (index < 0) index = playlist.length - 1;
		if (index >= playlist.length) index = 0;
		currentTrack = index;
		var song = playlist[currentTrack];

		renderNowPlaying();

		var playUrl = song.mp3 || urlCache[song.id];
		if (playUrl) {
			setupAudio(playUrl, autoPlay);
		} else {
			// 通过 API 获取播放地址
			showNotification('加载中…');
			apiGet({ types: 'url', source: SOURCE, id: song.id, br: 320 })
				.done(function(res) {
					if (res && res.url) {
						urlCache[song.id] = res.url;
						setupAudio(res.url, autoPlay);
					} else {
						showNotification('该歌曲暂时无法播放');
						if (autoPlay) nextTrack();
					}
				})
				.fail(function() {
					showNotification('网络异常，无法加载歌曲');
					if (autoPlay) nextTrack();
				});
		}
		// 懒加载封面
		if (!song.cover && song.pic_id && !picCache[song.id]) {
			apiGet({ types: 'pic', source: SOURCE, id: song.pic_id, size: 300 })
				.done(function(res) {
					if (res && res.url) {
						picCache[song.id] = res.url;
						song.cover = res.url;
						if (currentTrack === index) renderNowPlaying();
					}
				});
		}
	}

	function setupAudio(url, autoPlay) {
		if (audio) {
			audio.pause();
			audio.src = '';
			audio = null;
		}
		audio = new Audio(url);
		audio.preload = 'auto';
		audio.addEventListener('timeupdate', onTimeUpdate);
		audio.addEventListener('loadedmetadata', function() {
			$('.timer.right').text(fmtTime(audio.duration));
		});
		audio.addEventListener('ended', onEnded);
		audio.addEventListener('error', function() {
			showNotification('歌曲加载失败');
		});
		if (autoPlay) {
			play();
		}
	}

	function onTimeUpdate() {
		if (isSeeking || !audio) return;
		var cur = audio.currentTime || 0;
		var dur = audio.duration || 0;
		$('.timer.left').text(fmtTime(cur));
		if (dur) {
			$('.progress .fill').css('width', (cur / dur * 100) + '%');
			$('.progress .thumb').css('left', (cur / dur * 100) + '%');
		}
	}

	function onEnded() {
		if (isLoop) {
			audio.currentTime = 0;
			play();
		} else if (isShuffle) {
			nextShuffle();
		} else {
			nextTrack();
		}
	}

	function prevTrack() {
		if (isShuffle) { prevShuffle(); return; }
		loadTrack(currentTrack - 1, true);
	}

	function nextTrack() {
		if (isShuffle) { nextShuffle(); return; }
		loadTrack(currentTrack + 1, true);
	}

	function nextShuffle() {
		if (!shuffleOrder.length) buildShuffle();
		shuffleIndex = (shuffleIndex + 1) % shuffleOrder.length;
		loadTrack(shuffleOrder[shuffleIndex], true);
	}

	function prevShuffle() {
		if (!shuffleOrder.length) buildShuffle();
		shuffleIndex = (shuffleIndex - 1 + shuffleOrder.length) % shuffleOrder.length;
		loadTrack(shuffleOrder[shuffleIndex], true);
	}

	function buildShuffle() {
		shuffleOrder = [];
		for (var i = 0; i < playlist.length; i++) shuffleOrder.push(i);
		// Fisher-Yates
		for (var j = shuffleOrder.length - 1; j > 0; j--) {
			var k = Math.floor(Math.random() * (j + 1));
			var t = shuffleOrder[j];
			shuffleOrder[j] = shuffleOrder[k];
			shuffleOrder[k] = t;
		}
		// 当前曲目作为起点
		var idx = shuffleOrder.indexOf(currentTrack);
		if (idx > -1) shuffleIndex = idx;
	}

	function playTrack(index) {
		if (isShuffle) buildShuffle();
		loadTrack(index, true);
	}

	/* ---------- 歌曲搜索 ---------- */
	function searchSongs(keyword) {
		if (!keyword) return;
		var $btn = $('#plSearchBtn');
		var $input = $('#plSearchInput');
		$btn.prop('disabled', true).text('搜索中…');
		showNotification('正在搜索：' + keyword);
		apiGet({ types: 'search', source: SOURCE, name: keyword, count: 20, pages: 1 })
			.done(function(res) {
				if (!res || !res.length) {
					showNotification('没有找到相关歌曲');
					return;
				}
				// 保留本地歌曲在最前，其余替换为搜索结果
				var newList = [localSong];
				res.forEach(function(s) {
					newList.push({
						id: String(s.id),
						title: s.name,
						artist: (s.artist || []).join(' / '),
						album: s.album,
						pic_id: s.pic_id,
						lyric_id: s.lyric_id
					});
				});
				playlist = newList;
				currentTrack = 0;
				shuffleOrder = [];
				renderPlaylist();
				renderNowPlaying();
				showNotification('找到 ' + (playlist.length - 1) + ' 首歌曲');
			})
			.fail(function() {
				showNotification('搜索失败，请检查网络');
			})
			.always(function() {
				$btn.prop('disabled', false).text('搜索');
				$input.select();
			});
	}

	/* ---------- 默认歌单加载 ---------- */
	function loadDefaultSongs() {
		// 依次搜索关键词，合并进默认歌单（最多 3 次请求）
		var done = 0;
		var max = Math.min(DEFAULT_KEYWORDS.length, 3);
		DEFAULT_KEYWORDS.slice(0, max).forEach(function(kw) {
			apiGet({ types: 'search', source: SOURCE, name: kw, count: 6, pages: 1 })
				.done(function(res) {
					if (res && res.length) {
						res.forEach(function(s) {
							var id = String(s.id);
							if (urlCache[id] === undefined && !playlist.some(function(p) { return p.id === id; })) {
								playlist.push({
									id: id,
									title: s.name,
									artist: (s.artist || []).join(' / '),
									album: s.album,
									pic_id: s.pic_id,
									lyric_id: s.lyric_id
								});
							}
						});
						renderPlaylist();
					}
				})
				.fail(function() {})
				.always(function() {
					done++;
					if (done >= max) {
						$('.pl-loading').remove();
						renderPlaylist();
					}
				});
		});
	}

	/* ---------- 事件绑定 ---------- */
	function bindEvents() {
		// 播放/暂停
		$('.btn-play').on('click', togglePlay);
		// 上一首 / 下一首
		$('.btn-prev').on('click', prevTrack);
		$('.btn-next').on('click', nextTrack);
		// 随机播放
		$('.btn-shuffle').on('click', function() {
			isShuffle = !isShuffle;
			$(this).toggleClass('active', isShuffle);
			if (isShuffle) { buildShuffle(); showNotification('已开启随机播放'); }
			else { showNotification('已关闭随机播放'); }
		});
		// 单曲循环
		$('.btn-loop').on('click', function() {
			isLoop = !isLoop;
			$(this).toggleClass('active', isLoop);
			showNotification(isLoop ? '已开启单曲循环' : '已关闭单曲循环');
		});
		// 播放列表开关
		$('.btn-list').on('click', function() {
			togglePlaylist();
		});
		// 侧边缩放开关
		$('#pContent .ssBtn').on('click', function() {
			$('#QPlayer').toggleClass('open');
			$('.adf').toggleClass('on');
		});
		// 进度条点击/拖动
		var $bar = $('.progress .bar');
		function seekFromEvent(e) {
			var rect = $bar[0].getBoundingClientRect();
			var ratio = (e.clientX - rect.left) / rect.width;
			if (ratio < 0) ratio = 0;
			if (ratio > 1) ratio = 1;
			if (audio && audio.duration) {
				audio.currentTime = ratio * audio.duration;
				$('.progress .fill').css('width', (ratio * 100) + '%');
				$('.progress .thumb').css('left', (ratio * 100) + '%');
				$('.timer.left').text(fmtTime(audio.currentTime));
			}
		}
		$bar.on('mousedown touchstart', function(e) {
			isSeeking = true;
			seekFromEvent(e);
			$(document).on('mousemove touchmove', seekFromEvent);
		});
		$(document).on('mouseup touchend', function() {
			if (isSeeking) {
				isSeeking = false;
				$(document).off('mousemove touchmove', seekFromEvent);
			}
		});
		// 搜索
		$('#plSearchBtn').on('click', function() {
			var kw = $.trim($('#plSearchInput').val());
			if (kw) searchSongs(kw);
		});
		$('#plSearchInput').on('keydown', function(e) {
			if (e.keyCode === 13) {
				var kw = $.trim($(this).val());
				if (kw) searchSongs(kw);
			}
		});
		// 点击歌名区域可切换播放列表
		$('.musicTag').on('click', function() {
			togglePlaylist();
		});
	}

	function togglePlaylist() {
		var $pl = $('#playlist');
		$pl.toggleClass('go');
	}

	/* ---------- 初始化 ---------- */
	function init() {
		playlist = [localSong];
		renderPlaylist();
		renderNowPlaying();
		bindEvents();
		loadDefaultSongs();
		// 预加载本地歌曲（不自动播放，等待用户操作）
		setupAudio(localSong.mp3, false);
	}

	$(function() {
		init();
	});

})(jQuery);
