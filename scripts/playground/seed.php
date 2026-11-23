<?php
/**
 * 在 WordPress Playground 里把 content/ 下的内容灌成一个可渲染的站点。
 * 由 scripts/build.mjs 生成 .cache/seed/seed.json 后调用。
 *
 * @package tt3-github-pages
 */

// runPHP 步骤跑在裸 PHP 运行时里（WordPress 尚未加载），必须先自行引导。
$docroot = getenv( 'DOCROOT' ) ? getenv( 'DOCROOT' ) : '/wordpress';
if ( ! function_exists( 'wp_insert_post' ) ) {
	require_once $docroot . '/wp-load.php';
}

$seed_dir = '/wordpress/wp-content/uploads/seed';
$seed     = json_decode( file_get_contents( $seed_dir . '/seed.json' ), true );
$site     = $seed['site'];

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

/* ---------- 基础设置 ---------- */
update_option( 'blogname', $site['title'] );
update_option( 'blogdescription', $site['description'] );
update_option( 'posts_per_page', (int) $site['postsPerPage'] );
update_option( 'show_on_front', 'posts' );
update_option( 'permalink_structure', '/%postname%/' );
// 必须走 WP_Rewrite 才能让规则用新结构重建（直接 update_option 后内存里的还是旧结构）
global $wp_rewrite;
$wp_rewrite->set_permalink_structure( '/%postname%/' );
$wp_rewrite->flush_rules( true );

// 作者显示名（Playground 默认是 admin）
if ( ! empty( $site['author']['name'] ) ) {
	wp_update_user(
		array(
			'ID'           => 1,
			'display_name' => $site['author']['name'],
			'nickname'     => $site['author']['name'],
			'description'  => $site['author']['description'] ?? '',
		)
	);
}
update_option( 'timezone_string', 'Asia/Shanghai' );
update_option( 'date_format', 'Y年n月j日' );
update_option( 'default_comment_status', 'open' );
update_option( 'default_ping_status', 'closed' );

/* ---------- 清掉默认示例内容 ---------- */
foreach ( array( 'hello-world' ) as $slug ) {
	$p = get_page_by_path( $slug, OBJECT, 'post' );
	if ( $p ) {
		wp_delete_post( $p->ID, true );
	}
}
foreach ( array( 'sample-page', 'privacy-policy' ) as $slug ) {
	$p = get_page_by_path( $slug, OBJECT, 'page' );
	if ( $p ) {
		wp_delete_post( $p->ID, true );
	}
}
// 默认的「Hello world!」评论
foreach ( get_comments( array( 'number' => 50 ) ) as $c ) {
	wp_delete_comment( $c->comment_ID, true );
}

/* ---------- 分类 ---------- */
$term_ids = array();
foreach ( $site['categories'] as $cat ) {
	$term = term_exists( $cat['slug'], 'category' );
	if ( ! $term ) {
		$term = wp_insert_term( $cat['name'], 'category', array( 'slug' => $cat['slug'] ) );
	}
	$term_ids[ $cat['slug'] ] = (int) ( is_array( $term ) ? $term['term_id'] : $term );
}

/* ---------- 页面（决定导航顺序，TT3 的导航块会回退为页面列表） ---------- */
foreach ( $seed['pages'] as $page ) {
	$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
	if ( $existing ) {
		wp_delete_post( $existing->ID, true );
	}
	$id = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $page['title'],
			'post_name'    => $page['slug'],
			'post_content' => $page['content'],
			'post_excerpt' => $page['excerpt'],
			'menu_order'   => (int) $page['menuOrder'],
			'post_date'    => $page['date'],
			'post_date_gmt' => get_gmt_from_date( $page['date'] ),
		),
		true
	);
	echo 'page: ' . $page['slug'] . ' -> ' . $id . "\n";
}

/* ---------- 文章 ---------- */
$first_post_id = 0;
foreach ( $seed['posts'] as $post ) {
	$existing = get_page_by_path( $post['slug'], OBJECT, 'post' );
	if ( $existing ) {
		wp_delete_post( $existing->ID, true );
	}
	$id = wp_insert_post(
		array(
			'post_type'     => 'post',
			'post_status'   => 'publish',
			'post_title'    => $post['title'],
			'post_name'     => $post['slug'],
			'post_content'  => $post['content'],
			'post_excerpt'  => $post['excerpt'],
			'post_date'     => $post['date'],
			'post_date_gmt' => get_gmt_from_date( $post['date'] ),
			'comment_status' => 'open',
		),
		true
	);
	if ( is_wp_error( $id ) || ! $id ) {
		echo 'post failed: ' . $post['slug'] . "\n";
		continue;
	}
	if ( ! $first_post_id ) {
		$first_post_id = $id;
	}

	if ( ! empty( $post['category'] ) && isset( $term_ids[ $post['category'] ] ) ) {
		wp_set_post_terms( $id, array( $term_ids[ $post['category'] ] ), 'category' );
	}
	if ( ! empty( $post['tags'] ) ) {
		$tag_ids = array();
		foreach ( $post['tags'] as $tag ) {
			$name = is_array( $tag ) ? $tag['name'] : $tag;
			$slug = is_array( $tag ) ? (string) ( $tag['slug'] ?? '' ) : '';
			if ( '' === $name ) {
				continue;
			}
			$term = get_term_by( 'name', $name, 'post_tag' );
			if ( ! $term && $slug ) {
				$term = get_term_by( 'slug', $slug, 'post_tag' );
			}
			if ( $term ) {
				$tag_ids[] = (int) $term->term_id;
				continue;
			}
			$args = $slug ? array( 'slug' => $slug ) : array();
			$new  = wp_insert_term( $name, 'post_tag', $args );
			if ( ! is_wp_error( $new ) ) {
				$tag_ids[] = (int) $new['term_id'];
			}
		}
		if ( $tag_ids ) {
			wp_set_post_terms( $id, $tag_ids, 'post_tag' );
		}
	}

	// 特色图片（cover 为 .cache/seed/covers 里的文件名，coverExt 为扩展名，默认 png）
	if ( ! empty( $post['cover'] ) ) {
		$ext  = $post['coverExt'] ?? 'png';
		$mime = 'png' === $ext ? 'image/png' : 'image/jpeg';
		$src  = $seed_dir . '/covers/' . $post['cover'] . '.' . $ext;
		if ( file_exists( $src ) ) {
			$bits = wp_upload_bits( 'cover-' . $post['slug'] . '.' . $ext, null, file_get_contents( $src ) );
			if ( empty( $bits['error'] ) ) {
				$att = wp_insert_attachment(
					array(
						'post_mime_type' => $mime,
						'post_title'     => $post['title'],
						'post_status'    => 'inherit',
					),
					$bits['file'],
					$id
				);
				$meta = array();
				try {
					$meta = wp_generate_attachment_metadata( $att, $bits['file'] );
				} catch ( Throwable $e ) {
					$meta = array();
				}
				if ( empty( $meta['width'] ) ) {
					$size = @getimagesize( $bits['file'] );
					if ( $size ) {
						$meta = array(
							'width'  => $size[0],
							'height' => $size[1],
							'file'   => _wp_relative_upload_path( $bits['file'] ),
							'sizes'  => array(),
						);
					}
				}
				wp_update_attachment_metadata( $att, $meta );
				set_post_thumbnail( $id, $att );
			}
		}
	}
	echo 'post: ' . $post['slug'] . ' -> ' . $id . "\n";
}

// 评论功能已整体移除（静态站无后端）
if ( $first_post_id ) {
	clean_post_cache( $first_post_id );
}

/* ---------- 可选：套用 TT3 的某个 style variation ---------- */
if ( ! empty( $site['styleVariation'] ) ) {
	$variation = get_template_directory() . '/styles/' . $site['styleVariation'] . '.json';
	if ( file_exists( $variation ) ) {
		$data = json_decode( file_get_contents( $variation ), true );
		$data['version'] = 2;
		$data['isGlobalStylesUserThemeJSON'] = true;

		$old = get_posts(
			array(
				'post_type'   => 'wp_global_styles',
				'post_status' => 'any',
				'numberposts' => -1,
				'tax_query'   => array(
					array(
						'taxonomy' => 'wp_theme',
						'field'    => 'name',
						'terms'    => get_stylesheet(),
					),
				),
			)
		);
		foreach ( $old as $o ) {
			wp_delete_post( $o->ID, true );
		}

		$gs = wp_insert_post(
			array(
				'post_type'    => 'wp_global_styles',
				'post_status'  => 'publish',
				'post_title'   => 'Custom Styles',
				'post_name'    => 'wp-global-styles-' . get_stylesheet(),
				'post_content' => wp_json_encode( $data ),
			)
		);
		wp_set_object_terms( $gs, get_stylesheet(), 'wp_theme' );
		echo 'style variation: ' . $site['styleVariation'] . "\n";
	}
}

flush_rewrite_rules( true );
wp_cache_flush();
// 给构建脚本的就绪标记：CLI 会在蓝图步骤还在跑的时候就开始对外服务，
// 必须在种子数据完全落库之后再开始抓取。
file_put_contents( $seed_dir . '/.seeded', (string) time() );
echo "seed done\n";
